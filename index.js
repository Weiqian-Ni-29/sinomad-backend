// index.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// 中间件
app.use(bodyParser.json());
app.use(cors());

// 引入日期选择相关的路由模块
const travelInfo = require('./controllers/TravelInfo');

// 使用日期选择相关的路由，挂载在 /api 路径下
app.use('/api', travelInfo);

// 默认路由
app.get('/', (req, res) => {
  res.send('Node.js backend startup successfully');
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
export default app;
