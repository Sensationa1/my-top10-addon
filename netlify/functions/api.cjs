"use strict";
const serverless = require("serverless-http");
const app = require("../../api/index.js");
exports.handler = serverless(app);
