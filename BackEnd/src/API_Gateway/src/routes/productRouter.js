// src/routes/userRouter.js
const express = require('express');
const router = express.Router();
const { StatusCodes } = require('http-status-codes');
const ServiceClient = require('../services/serviceClient');

const productServiceClient = new ServiceClient('product_service');

const errorHandler = (error, res) => {
  console.error('Service Error:', error);
  const status = error.response?.status || StatusCodes.INTERNAL_SERVER_ERROR;
  const message = error.response?.data?.message || 'Internal Server Error';

  res.status(status).json({
    success: false,
    message,
    error: error.message,
  });
};

router.get('/get-all', async (req, res) => {
  try {
    const response = await productServiceClient.get('/api/product/get-all', {
      params: req.query,
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    errorHandler(error, res);
  }
});

module.exports = router;
