const { AlipaySdk } = require('alipay-sdk');
const express = require('express');
const router = express.Router();

const alipaySdk = new AlipaySdk({
  appId: process.env.ALIPAY_APPID,
  privateKey: process.env.ALIPAY_APP_PRIVATE_KEY,
  alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY,
  // gateway: 	'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
  gateway: 'https://openapi.alipay.com/gateway.do',
  sandbox: false,
  signType:'RSA2'
});


// 支付宝异步通知（需公网可访问）
router.post('/payment/notify', async (req, res) => {
  console.log("notify triggered");
  try {
    // 1. 验签（确保通知来自支付宝）
    const isSignatureValid = await alipaySdk.checkNotifySign(req.body);
    if (!isSignatureValid) {
      throw new Error("支付宝通知验签失败");
    }

    console.log("req.body" + req.body);
    // 2. 解析支付宝通知参数
    const result = alipaySdk.decryptNotifyParams(req.body);
    console.log("支付宝通知参数:", result);

    // 3. 处理交易成功逻辑
    if (result.trade_status === 'TRADE_SUCCESS') {
      const { out_trade_no, trade_no } = result;
      console.log("订单支付成功，订单号:", out_trade_no);
      res.send('success');
    } else {
      console.log("交易未成功，状态:", result.trade_status);
      res.send('failure');
    }
  } catch (error) {
    console.error("支付宝通知处理失败:", error);
    res.status(500).send('error');
  }
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

module.exports = router;
