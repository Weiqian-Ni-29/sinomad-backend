const express = require('express');
const router = express.Router();
const pool = require('./DB');
const dayjs = require('dayjs');

// 改进1: 将路线配置移至环境变量
const ROUTE_CONFIG = JSON.parse(process.env.ROUTE_MAX_PEOPLE || '{}');
const ROUTE_STARTUP = JSON.parse(process.env.ROUTE_STARTUP_NUM || '{}');
const routeMaxPeople = new Map(Object.entries(ROUTE_CONFIG));
const routeStartUpNum = new Map(Object.entries(ROUTE_STARTUP));

// 改进2: SQL 语句集中管理
const SQL = {
  GET_AVAILABILITY: `
    SELECT departure_time, ($2 - num_of_travelers) AS vacant_slots
    FROM bookinginfo 
    WHERE route = $1 
      AND departure_time BETWEEN NOW() AND NOW() + INTERVAL '1 month'
      AND num_of_travelers < $2 
  `,

  CHECK_STOCK: `
    SELECT ($4 - num_of_travelers - $1) AS vacant
    FROM bookinginfo
    WHERE route = $2 AND departure_time = $3
  `,

  CREATE_ORDER: `
    INSERT INTO userinfo (
      order_number, name, email, region_code, phone, 
      travel_date, travelers, route, paid, amount_paid, transaction_time, comment
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, NOW(), $10)
    RETURNING *
  `,

  UPDATE_BOOKING: `
    UPDATE bookinginfo 
    SET num_of_travelers = num_of_travelers + $1
    WHERE route = $2 AND departure_time = $3
  `,

  GET_ORDER_INFO: `
    SELECT order_number, name, region_code, phone, email, travelers, travel_date
    from userinfo
    where order_number = $1
  `,

  SET_STATUS_PAYED: `
    UPDATE userinfo
    SET paid=true
    where order_number = $1
  `,

  GET_OVERTIME_UNPAYED_ORDERS: `
    SELECT travelers, route, travel_date
    FROM userinfo
    WHERE paid is NULL and transaction_time < NOW() - INTERVAL '15 minutes'
  `,

  SET_OVERTIME_PAYMENT_STATUS_TO_FALSE: `
    UPDATE userinfo
    set paid = false
    where paid is NULL and transaction_time < NOW() - INTERVAL '15 minutes'
  `,

  REMOVE_OVERTIME_BOOKING_FROM_BOOKINGINFO_TABLE: `
    UPDATE bookinginfo
    set num_of_travelers = num_of_travelers - $1
    where route = $2 and departure_time = $3
  `
};

// 改进3: 统一错误处理中间件
const handleError = (res, error, message = 'Server error') => {
  console.error(`[${new Date().toISOString()}] Error: ${error.message}`);
  res.status(500).json({ 
    success: false,
    error: process.env.NODE_ENV === 'development' ? message : error.message 
  });
};

// 改进4: 日期处理工具函数
const parseAndFormatDate = (dateInput) => {
  try {
    const parsed = dayjs(dateInput.$d || dateInput);
    if (!parsed.isValid()) throw new Error('Invalid date format');
    return parsed.format('YYYY-MM-DD');
  } catch (error) {
    throw new Error(`Date processing failed: ${error.message}`);
  }
};

router.get('/available-dates-n-vacancies', async (req, res) => {
  try {
    const { route } = req.query;
    
    // 参数验证增强
    if (!route || !routeMaxPeople.has(route)) {
      return res.status(400).json({ 
        error: 'Invalid route parameter',
        validRoutes: Array.from(routeMaxPeople.keys()) 
      });
    }

    // 从配置获取 maxPeople
    const maxPeople = routeMaxPeople.get(route);
    if (typeof maxPeople !== 'number' || maxPeople <= 0) {
      return res.status(500).json({ 
        error: 'Invalid maxPeople configuration' 
      });
    }

    // 修改点4：传递两个参数（route 和 maxPeople）
    const { rows } = await pool.query(SQL.GET_AVAILABILITY, [route, maxPeople]);
    
    const startUpNum = routeStartUpNum.get(route);

    // 优化数据结构处理
    const result = {
      departureTimes: rows.map(r => r.departure_time),
      vacantSlots: rows.map(r => r.vacant_slots),
      maxCapacity: maxPeople,
      startUpNum: startUpNum
    };

    res.json(result);
  } catch (error) {
    handleError(res, error, 'Failed to fetch availability');
  }
});

// 提交预定
router.post('/submit-booking', async (req, res) => {
  try {
    const { date, numberOfTravelers, route } = req.body;
    
    if (!date || !numberOfTravelers || !route) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 改进6: 事务封装
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // 检查库存
      const stockCheck = await client.query(SQL.CHECK_STOCK, [
        numberOfTravelers, 
        route, 
        date,
        routeMaxPeople.get(route)
      ]);
      
      if (stockCheck.rows[0]?.vacant < 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Insufficient vacancies' });
      }

      // 记录预定（示例，根据实际需求补充）
      console.log(`Booking received: ${date} - ${numberOfTravelers} travelers`);
      
      await client.query('COMMIT');
      res.json({ success: true });
    } finally {
      client.release();
    }
  } catch (error) {
    handleError(res, error, 'Booking submission failed');
  }
});

// 查询订单信息，顺便把订单paid信息置为true
router.get('/orders/:orderNumber', async (req, res) => {
  const client = await pool.connect();
  try {
    const orderNumber = req.params.orderNumber;
    await client.query(SQL.SET_STATUS_PAYED, [
      orderNumber
    ]);
    const orderInfo = await client.query(SQL.GET_ORDER_INFO, [
      orderNumber
    ]);
    res.json({orderInfo: orderInfo.rows[0]});
  } catch (error) {
    handleError(res, error, 'Failed to update/retrive booking status');
  } finally {
    client.release();
  }
});

// 用户信息提交
router.post('/submit-userinfo', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { 
      order_number, name, email, phone, region_code, 
      amount_paid, travelers, travel_date, route, comment
    } = req.body;

    // 改进7: 参数验证中间件
    const requiredFields = [
      'order_number', 'name', 'email', 'phone', 
      'amount_paid', 'travelers', 'travel_date', 'route'
    ];
    
    const missing = requiredFields.filter(field => !req.body[field]);
    if (missing.length > 0) {
      return res.status(400).json({ 
        error: `Missing fields: ${missing.join(', ')}` 
      });
    }

    const formattedDate = parseAndFormatDate(travel_date);

    // 库存检查
    const stockResult = await client.query(SQL.CHECK_STOCK, [
      travelers,        // $1
      route,            // $2
      formattedDate,    // $3
      routeMaxPeople.get(route) // $4 新增参数
    ]);
    
    if (stockResult.rows[0]?.vacant < 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Insufficient stock' });
    }

    // 创建订单
    const orderResult = await client.query(SQL.CREATE_ORDER, [
      order_number, name, email, region_code, phone,
      formattedDate, travelers, route, amount_paid, comment
    ]);
    
    // 更新库存
    await client.query(SQL.UPDATE_BOOKING, [
      travelers, 
      route, 
      formattedDate
    ]);
    
    await client.query('COMMIT');
    
    res.json({ 
      success: true,
      order: orderResult.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    handleError(res, error, 'Order processing failed');
  } finally {
    client.release();
  }
});

// 每分钟执行一次，去数据库中读取超时15分钟的订单，并从bookingInfo里面减去
setInterval(async () => {
  const client = await pool.connect();
  try {
    const result = await client.query(SQL.GET_OVERTIME_UNPAYED_ORDERS);
    const timeout_orders = result.rows;
    for (let i = 0; i < timeout_orders.length; i++) {
      const travelers = timeout_orders[i].travelers;
      const route = timeout_orders[i].route;
      const travel_date = timeout_orders[i].travel_date;
      await client.query(SQL.REMOVE_OVERTIME_BOOKING_FROM_BOOKINGINFO_TABLE, [
        travelers, route, travel_date
      ]);
    }
    await client.query(SQL.SET_OVERTIME_PAYMENT_STATUS_TO_FALSE)
  } catch (error) {
    throw error;
  } finally {
    client.release();
  }
}, 60000);


module.exports = router;
