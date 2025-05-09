const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const serviceRegistry = require('./src/services/serviceRegistry');
const path = require('path');
const app = express();
require('dotenv').config();
// const logger = require('../../src/API_Gateway/utils/logger');

// Routes
const userRoutes = require('./src/routes/userRouter');
const productRoutes = require('./src/routes/productRouter');
const orderRoutes = require('./src/routes/orderRouter');
const cartRoutes = require('./src/routes/cartRouter');
const paymentRoutes = require('./src/routes/paymentRouter');
const searchRoutes = require('./src/routes/searchRouter');

/* Rate Limit Client: nếu vượt quá nó báo lỗi To many request, tất cả các request gửi đến API Gateway, không phân
 biệt service. status(429) là mã HTTP Too Many Requests
 khỏi bị spam, DDOS, abuse
*/
let requestCounter = {};

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 1000, // tối da 1000 request trong 15 phút
  handler: (req, res) => {
    //  logger.warn(`IP ${req.ip} đã bị rate limit sau ${requestCounter[req.ip] || 'unknown'} requests`);
    res.status(429).json({ message: 'Too many requests. Please try again later.' });
  },
  onLimitReached: (req, res, options) => {
    //  logger.warn(`Rate limit hit for ${req.ip} on ${req.originalUrl}`);
  },
  keyGenerator: (req) => {
    requestCounter[req.ip] = (requestCounter[req.ip] || 0) + 1;
    return req.ip;
  },
});

// Middleware
app.use(limiter);
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something broke!',
    error: err.message,
  });
});

app.use('/api/user', userRoutes);
app.use('/api/product', productRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/search', searchRoutes);

// Đăng ký API Gateway cho các service
serviceRegistry.register({
  name: 'api-gateway',
  host: process.env.HOST || 'localhost',
  port: process.env.PORT || 5555,
  endpoints: ['/api/user/*', '/api/product/*', '/api/order/*', '/api/cart/*', '/api/payment/*', '/api/search/*'],
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Service Registry endpoint
app.post('/register', (req, res) => {
  try {
    const serviceId = serviceRegistry.register(req.body);
    res.json({ success: true, serviceId });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Theo dõi debug
app.get('/debug/services', (req, res) => {
  const servicesDebug = {};
  for (const [name, instances] of serviceRegistry.services) {
    servicesDebug[name] = Array.from(instances.values());
  }
  res.json({
    services: servicesDebug,
    timestamp: new Date().toISOString(),
  });
});

// hủy đăng ký service
app.post('/unregister/:serviceId', (req, res) => {
  const success = serviceRegistry.unregister(req.params.serviceId);
  res.json({ success });
});

// kiểm tra trạng thái service
app.post('/heartbeat/:serviceId', (req, res) => {
  const success = serviceRegistry.heartbeat(req.params.serviceId);
  res.json({ success });
});

app.get('/services', (req, res) => {
  const services = {};
  for (const [name, instances] of serviceRegistry.services) {
    services[name] = Array.from(instances.values());
  }
  res.json(services);
});

const PORT = process.env.PORT || 5555;
app.listen(PORT, () => {
  console.log(`🚀 API Gateway running on http://localhost:${PORT}`);
});
