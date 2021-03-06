/*jslint browser: true*/
/*jslint newcap: true*/

'use strict';

var axios  = require('axios');
var Qretry = require('qretry');
var PubSub = require('pubsub-js');
var Q      = require('q');

/**
 * Stores and manages singleton (static)
 * data for blocked API endpoint groups
 *
 * @type {Object}
 */
var blockedGroups = {
  list: [],
  add: function (groupName) {
    if (!this.contains(groupName)) {
      this.list.push(groupName);
    }
  },
  remove: function (groupName) {
    var groupIndex = this.list.indexOf(groupName);

    if (groupIndex > -1) {
      this.list.splice(groupIndex, 1);
    }
  },
  contains: function (groupName) {
    return (this.list.indexOf(groupName) > -1);
  }
};

/**
 * Library default options &
 * option-related helper functions
 *
 * @type {Object}
 */
var options = {
  defaults: {
    retry: {
      max: 2,
      interval: 100,
      intervalMultiplicator: 1,
    },
    reAttempt: {
      max: 3,
      interval: 1000,
      intervalMultiplicator: 1,
    }
  },
  override: function (options, defaultOptions) {
    var resultConfig = {};

    Object.keys(defaultOptions).map(function (key) {
      resultConfig[key] = options[key] || defaultOptions[key];
    });

    return resultConfig;
  },
  parse: function (options, defaultOptions) {
    var resultantOptions;

    if (!options || Object.keys(options).length === 0) {
      resultantOptions = defaultOptions;
    } else {
      resultantOptions = this.override(options, defaultOptions);
    }

    return resultantOptions;
  }
};

var strategies = {
  list: {
    'resilient': {
      retry: {
        max: 5,
        interval: 100,
        intervalMultiplicator: 1,
      },
      reAttempt: {
        max: 10,
        interval: 1000,
        intervalMultiplicator: 1,
      }
    },
    'exponential-backoff': {
      retry: {
        max: 2,
        interval: 100,
        intervalMultiplicator: 1.5,
      },
      reAttempt: {
        max: 3,
        interval: 1000,
        intervalMultiplicator: 1.5,
      }
    },
  },
  get: function (strategyName) {

    var strategy;

    if (this.list[strategyName] === undefined) {
      strategy = false;
    } else {
      strategy = this.list[strategyName];
    }

    return strategy;
  },
  add: function (strategyName, strategyOptions) {

    if (this.get(strategyName)) {
      return false;
    }

    this.list[strategyName] = strategyOptions;

  }
};

/**
 * Default library message texts
 *
 * @type {Object}
 */
var messages = {
  retryFailed: 'Request failed.',
  reAttemptsFailed: 'Re-attempts of request failed.',
  requestsBlocked: 'Requests are currently blocked by Retry library.',
};

/**
 * Patience-JS initializing function
 */
var Patience = function () {

  return {
    _options: {},
    _configure: function () {

      // if retry options are not present
      if (this._options.retry === undefined) {
        // call options setter to populate defaults
        this.retry();
      }

      // if group was not set,
      if (this._options.group === undefined) {
        // assume request url as group
        this.group(this._options.request.url);
      }

      // Qretry options key translation
      this._options.retry.maxRetry = this._options.retry.max;

      // Qretry param interpretation.
      // Re-attempts are a total sum in this library
      if (this._options.reAttempt !== undefined) {
        this._options.reAttempt.maxRetry = this._options.reAttempt.max - 1;
      }
    },
    _doRequest: function () {
      return axios(this._options.request);
    },
    _doRetry: function (response) {
      var self = this;

      // Retry
      Qretry(function () {

        return self._doRequest();

      }, self._options.retry).then(function (res) {

        // original request or retry succeeded.
        // resolve http response
        response.resolve(res);

      }).catch(function (err) {

        PubSub.publish('retriesFailed', messages.retryFailed);

        if (self._options.reAttempt) {

          response.notify({
            message: messages.retryFailed,
            error: err
          });

          // block future async calls
          blockedGroups.add(self._options.group);

          // start re-attempt
          self._doReAttempt(response);

        } else {

          response.reject({
            message: messages.retryFailed,
            error: err,
          });

        }

      });
    },
    _doReAttempt: function (response) {

      var self = this;

      // Re-attempt
      Qretry(function () {

        return axios(self._options.request);

      }, self._options.reAttempt).then(function (res) {

        // successful re-attempt
        blockedGroups.remove(self._options.group);
        response.resolve(res);

      }).catch(function (err) {

        // all re-attempts failed.
        blockedGroups.remove(self._options.group);
        PubSub.publish('reAttemptsFailed', messages.reAttemptsFailed);
        response.reject({
          message: messages.reAttemptsFailed,
          err: err
        });

      });
    },
    retry: function (params) {
      this._options.retry = options.parse(params, options.defaults.retry);
      return this;
    },
    request: function (params) {
      this._options.request = params;
      return this;
    },
    reAttempt: function (params) {
      this._options.reAttempt = options.parse(params, options.defaults.reAttempt);
      return this;
    },
    group: function (name) {
      this._options.group = name;
      return this;
    },
    run: function () {

      this._configure();

      var response = Q.defer();

      if (blockedGroups.contains(this._options.group)) {

        response.reject({ message: messages.requestsBlocked });

      } else {

        this._doRetry(response);

      }

      return response.promise;
    },
    _strategyHelper: function (optionName, options) {
      if (options) {
        this[optionName](options);
      }

    },
    addStrategy: function (strategyName, strategyOptions) {
      strategies.add(strategyName, strategyOptions);
    },
    runStrategy: function (strategyName) {

      var strategy = strategies.get(strategyName);
      var self = this;

      if (!strategy) {
        console.error('Retry strategy', strategyName, 'not found.');
        return false;
      }

      Object.keys(strategy).map(function (key) {
        self._strategyHelper(key, strategy[key]);
      });

      return this.run();
    }
  };

};


(function (name, obj) {

  var commonJS = typeof module != 'undefined' && module.exports;

  if (commonJS) {
    module.exports = obj;
  } else {
    window[name] = obj;
  }

  if (window.angular) {

    angular.module('PatienceJS', []);

    angular
      .module('PatienceJS')
      .service('$httpRetry', function () {
        return Patience();
      });
  }

}('Patience', Patience));

