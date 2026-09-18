'use strict';

const axios = require('axios');

class ApiClient {
  constructor(axiosInstance = axios) {
    this.axiosInstance = axiosInstance;
  }

  async get(url, options = {}) {
    return this.axiosInstance.get(url, options);
  }

  async post(url, data, options = {}) {
    return this.axiosInstance.post(url, data, options);
  }
}

module.exports = {
  ApiClient,
};
