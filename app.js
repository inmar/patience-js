'use strict';

/**
 * Proof of Concept:
 *   Auto-retry of AJAX requests in AngularJS.
 *   Details: https://inmarb2b.visualstudio.com/DefaultCollection/Portal/_backlogs#level=Backlog+items&showParents=false&_a=backlog
 *
 */

/**
 * Library
 */
(function () {

  var demoCtrl = function ($scope, API, notify) {
    var vm = this;

    vm.showNotification = function (notificationConfig) {
      $scope.$apply(function () {
        notify.closeAll();
        vm.currentNotification = notify(notificationConfig);
      });
    };


    PubSub.subscribe('failedRetries', function () {

      vm.showNotification({
        message: 'Network is down.',
        position: 'right',
      });

    });

    PubSub.subscribe('reAttemptSuccessful', function () {

      vm.showNotification({
        message: 'Network is back up.',
        position: 'right',
      });

    });

    vm.makeRequest = function (times, interval) {
      console.clear();
      API.makeFailingRequest(times, interval, true);
    };

  };

  function apiService($http, $httpRetry) {
    var badRequestConfig  = {
      method: 'GET',
      url: 'http://localhost:8080/bad-url'
    };

    var goodRequestConfig = {
      method: 'GET',
      url: 'http://localhost:8080'
    };

    this.makeFailingRequest = function (times, interval) {

      var retryParams;
      var request;

      if (times !== undefined && interval !== undefined) {
        retryParams = {
          max: times,
          interval: interval,
        };

        console.log(times, interval);
        console.log('sending in', retryParams);
        request = $httpRetry(badRequestConfig, retryParams);
      } else {
        request = $httpRetry(badRequestConfig);
      }

      debugger;

      return request.then(function (res) {
        return res.data;
      }).catch(function (err) {
        return err;
      });

    };

    this.makeSuccessfulRequest = function () {
      return $http(goodRequestConfig).then(function (res) {
        return res.data;
      });
    };
  }

  /**
   * Angular App
   */
  angular.module('retryDemo', [
    'autoRetry',
    'cgNotify'
  ]);

  angular
    .module('retryDemo')
    .service('API', ['$http', '$httpRetry', apiService])
    .controller('demoCtrl', demoCtrl);

}());