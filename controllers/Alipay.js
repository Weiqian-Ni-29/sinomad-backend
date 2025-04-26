const { AlipaySdk } = require('alipay-sdk');
const express = require('express');
const router = express.Router();

const alipaySdk = new AlipaySdk({
  appId: process.env.ALIPAY_APPID,
  privateKey: process.env.ALIPAY_APP_PRIVATE_KEY,
  alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY,
  // gateway: 	'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
  gateway: 'https://openapi.alipay.com/gateway.do',
  sandbox: true,
  signType:'RSA2'
});

router.post('/payment/:platform', async (req, res) => {
    try {
        const { 
            order_number, 
            amount, 
            subject,
            order_info
        } = req.body;

    if (!order_number || !amount) {
        return res.status(400).send('Missing required parameters');
    }
      // 判断是电脑页面，还是手机页面
      const isPC = req.params.platform === 'page';
      const method = isPC ? 'alipay.trade.page.pay' : 'alipay.trade.wap.pay';
      const productCode = isPC ? 'FAST_INSTANT_TRADE_PAY' : 'QUICK_WAP_WAY';
  
      // 支付订单信息
      const bizContent = {
        out_trade_no: order_number.toString(),
        product_code: productCode,
        total_amount: Number(amount).toFixed(2).toString(),
        subject: subject.substring(0, 256)
      };
  
      const url = alipaySdk.pageExecute(method, 'GET', {
        bizContent,
        returnUrl: process.env.RETURN_URL,
        notify_url: process.env.NOTIFY_URL,
      });
      console.log("Alipay url generated: ",url);
      res.json({
        success: true,
        payment_url: url
      });
    } catch (error) {
      console.error('Payment Error:', error);
        res.status(400).json({ 
            success: false,
            error: error.message || 'Payment processing failed'
        });
    }
});

// 支付宝异步通知（需公网可访问）
router.post('/payment/notify', async (req, res) => {
  console.log("notify triggered")
  try {
    const result = await alipaySdk.checkNotify(req.body);
    if (result.trade_status === 'TRADE_SUCCESS') {
      // 更新数据库订单状态
      const {
        out_trade_no,    // 商户订单号（你系统生成的订单号）
        trade_no,        // 支付宝交易号
        total_amount,    // 订单金额
        buyer_id,        // 买家支付宝用户ID
        seller_id,       // 卖家支付宝用户ID
        invoice_amount   // 开票金额
      } = result;
      console.log(result);
      res.send('success'); // 必须返回success告知支付宝已处理
    } else {
      console.log("payment failed!");
      res.send('failure');
    }
  } catch (error) {
    res.status(500).send('error');
  }
});

module.exports = router;
