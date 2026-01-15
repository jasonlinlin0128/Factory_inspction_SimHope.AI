const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const sheetsService = require('./sheetsService');

admin.initializeApp();

// LINE Messaging API 設定
const LINE_CONFIG = {
  channelAccessToken: 'CGP/yRRpZzlFOpCqrYN3pMGP/AdfYj6Xaz1knjxJr5wWwzWRVwF8pkndiSChHYJG27cmk6sqkNp/L7QFIuevOJIlmTkqA1SuCKAK3oXTOk4ZUUFy0TdcAHXbYyICzs7s4dBOOXXRgmoTgUcKLbotZgdB04t89/1O/w1cDnyilFU=',
  channelSecret: '7db2050b2242cc400cef0825b2673720',
  channelId: '2007534866',
  // 多個接收者的 User ID 陣列
  recipientUserIds: [
    'Uf8d0ac749c7a7f4e8b19bb711713da7e',  // 主管
    'U3f549dade4b3c94f2d404426da73aa29'   // 老闆
  ]
};

/**
 * 發送 LINE Messaging API 推播訊息（支援多接收者和多訊息）
 * @param {string|string[]} userIds - LINE User ID 或 User ID 陣列
 * @param {string|object|array} messages - 訊息內容（字串、單個訊息物件或訊息陣列）
 * @returns {Promise<boolean>} 至少一個接收者發送成功返回 true
 */
async function sendLineMessage(userIds, messages) {
  // 統一轉換為陣列（支援向後相容）
  const recipients = Array.isArray(userIds) ? userIds : [userIds];

  // 統一處理訊息格式
  let messageArray;
  if (typeof messages === 'string') {
    // 字串：轉換為文字訊息
    messageArray = [{ type: 'text', text: messages }];
  } else if (Array.isArray(messages)) {
    // 已經是陣列：直接使用
    messageArray = messages;
  } else {
    // 單個訊息物件：轉換為陣列
    messageArray = [messages];
  }

  console.log(`準備發送 ${messageArray.length} 則 LINE 訊息給 ${recipients.length} 位接收者`);

  const results = {
    success: 0,
    failed: 0,
    details: []
  };

  // 並行發送給所有接收者
  const promises = recipients.map(async (userId) => {
    try {
      console.log('發送訊息給:', userId);

      const response = await axios.post(
        'https://api.line.me/v2/bot/message/push',
        {
          to: userId,
          messages: messageArray  // 使用處理後的訊息陣列
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LINE_CONFIG.channelAccessToken}`
          },
          timeout: 10000
        }
      );

      console.log(`✓ 發送成功 (${userId}), 狀態碼: ${response.status}`);
      results.success++;
      results.details.push({ userId, success: true });

    } catch (error) {
      console.error(`✗ 發送失敗 (${userId}):`, error.message);
      if (error.response) {
        console.error('HTTP 狀態碼:', error.response.status);
        console.error('回應內容:', JSON.stringify(error.response.data));
      }
      results.failed++;
      results.details.push({
        userId,
        success: false,
        error: error.message
      });
    }
  });

  // 等待所有發送完成
  await Promise.allSettled(promises);

  console.log(`LINE 訊息發送完成: 成功 ${results.success}, 失敗 ${results.failed}`);

  // 至少有一個成功就返回 true
  return results.success > 0;
}

/**
 * Trigger 1: 新異常回報時記錄到 Google Sheets
 * 當 abnormal_reports collection 新增文件時觸發
 * 注意：LINE 通知改為在區域完成時一併發送（onInspectionComplete.js）
 */
exports.onAbnormalReportCreated = functions
  .region('asia-east1')
  .firestore
  .document('abnormal_reports/{reportId}')
  .onCreate(async (snapshot, context) => {
    const report = snapshot.data();

    console.log('偵測到新異常回報:', context.params.reportId);
    console.log('異常項目:', report.itemName || '未知');
    console.log('注意：LINE 通知將在區域完成時一併發送');

    try {
      // 如果有照片，上傳到 Storage
      let imageUrl = null;
      if (report.imageBase64) {
        console.log('偵測到異常回報包含照片，準備上傳...');

        const fileName = `abnormal_${report.pointId}_${context.params.reportId}_${Date.now()}.jpg`;
        imageUrl = await sheetsService.uploadImageToStorage(report.imageBase64, fileName);

        if (imageUrl) {
          console.log('照片上傳成功，URL:', imageUrl);
        } else {
          console.warn('照片上傳失敗');
        }
      }

      // 同步到 Google Sheets
      await sheetsService.logAbnormalReport({
        timestamp: report.timestamp,
        pointId: report.pointId,
        pointName: report.pointName,
        inspectorName: report.inspectorName,
        deviceInfo: report.deviceInfo || {},
        description: report.description,
        imageBase64: report.imageBase64
      });

      // 更新文件，儲存圖片 URL（如果有）
      const updateData = {};
      if (imageUrl) {
        updateData.imageUrl = imageUrl;
      }
      if (Object.keys(updateData).length > 0) {
        await snapshot.ref.update(updateData);
      }

      console.log('異常回報記錄處理完成');
    } catch (error) {
      console.error('處理異常回報失敗:', error);
    }
  });

/**
 * Trigger 2: 異常處理完成時更新狀態
 * 當 abnormal_reports 文件的 status 從 reported 變為 resolved 時觸發
 *
 * 注意：由於 LINE Token 綁定到主管個人，處理完成不發送 LINE 通知
 * 巡檢員可透過「我的回報」功能查看處理狀態
 */
exports.onAbnormalReportResolved = functions
  .region('asia-east1')
  .firestore
  .document('abnormal_reports/{reportId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    console.log('異常回報更新觸發:', context.params.reportId);
    console.log('Before status:', before.status);
    console.log('After status:', after.status);

    // 只在狀態從 reported 變為 resolved 時觸發
    if (before.status === 'reported' && after.status === 'resolved') {
      console.log('✓ 條件符合：偵測到異常已處理');
      console.log('處理人:', after.resolvedBy);
      console.log('原回報人可透過「我的回報」查看處理結果');

      try {
        // 同步處理狀態到 Google Sheets
        await sheetsService.updateAbnormalResolution({
          timestamp: before.timestamp,
          pointId: after.pointId,
          pointName: after.pointName,
          inspectorName: after.inspectorName,
          deviceInfo: after.deviceInfo || {},
          description: after.description,
          resolvedBy: after.resolvedBy,
          resolution: after.resolution
        });

        // 發送 LINE 通知給主管
        const itemInfo = after.itemName ? `\n異常項目：${after.itemName}` : '';
        const resolvedMessage = `
✅ 異常已處理完畢

巡檢點：${after.pointName}${itemInfo}
原回報人：${after.inspectorName}
處理人：${after.resolvedBy}
處理時間：${after.resolvedAt.toDate().toLocaleString('zh-TW', {
  timeZone: 'Asia/Taipei',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
})}

原異常描述：
${after.description}

處理說明：
${after.resolution}
        `.trim();

        // 發送處理完畢通知給所有接收者（主管和老闆）
        await sendLineMessage(LINE_CONFIG.recipientUserIds, resolvedMessage);

        // 標記處理完成通知已發送
        await change.after.ref.update({ resolutionNotificationSent: true });
        console.log('異常處理狀態已更新，LINE 通知已發送');
      } catch (error) {
        console.error('更新狀態失敗:', error);
      }
    }
  });

// 儀表板網址
const DASHBOARD_URL = 'https://jasonlinlin0128.github.io/Factory_inspction_SimHope.AI/index.html';

/**
 * LINE Bot Webhook - 提供儀表板網址及相關指令
 * Webhook URL: https://asia-east1-factory-inspection-system.cloudfunctions.net/lineWebhook
 */
exports.lineWebhook = functions
  .region('asia-east1')
  .https
  .onRequest(async (req, res) => {
    console.log('收到 LINE Webhook 請求');

    // 只處理 POST 請求
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const events = req.body.events;

    if (!events || events.length === 0) {
      console.log('沒有事件');
      return res.status(200).send('OK');
    }

    // 處理每個事件
    for (const event of events) {
      console.log('事件類型:', event.type);

      if (event.type === 'message' && event.message.type === 'text') {
        const userId = event.source.userId;
        const messageText = event.message.text.toLowerCase().trim();

        console.log('User ID:', userId);
        console.log('訊息內容:', messageText);

        let replyMessage = '';

        // 檢查關鍵字
        if (messageText.includes('儀表板') ||
            messageText.includes('查看') ||
            messageText.includes('網址') ||
            messageText.includes('url') ||
            messageText.includes('連結') ||
            messageText.includes('link') ||
            messageText.includes('巡檢') ||
            messageText === '1') {
          // 回覆儀表板網址
          replyMessage = `📊 巡檢管理儀表板\n\n點擊下方連結查看即時巡檢狀態：\n${DASHBOARD_URL}\n\n功能說明：\n• 查看各區域巡檢狀態\n• 檢視異常回報紀錄\n• 查詢歷史巡檢記錄`;
        } else if (messageText.includes('help') ||
                   messageText.includes('幫助') ||
                   messageText.includes('說明') ||
                   messageText === '?') {
          // 回覆使用說明
          replyMessage = `🔧 巡檢系統 LINE Bot 指令說明\n\n輸入以下關鍵字獲取資訊：\n\n📊 「儀表板」「查看」「網址」「1」\n→ 獲取巡檢管理儀表板連結\n\n❓ 「幫助」「說明」「?」\n→ 顯示此說明訊息\n\n📱 「ID」\n→ 查看您的 LINE User ID`;
        } else if (messageText.includes('id')) {
          // 回覆 User ID
          replyMessage = `📱 您的 LINE User ID\n\n${userId}\n\n此 ID 用於系統管理設定。`;
        } else {
          // 預設回覆（快速選單）
          replyMessage = `👋 您好！我是巡檢系統小助手\n\n請輸入以下指令：\n\n1️⃣ 輸入「1」查看儀表板\n❓ 輸入「?」查看說明\n\n或直接點擊連結：\n${DASHBOARD_URL}`;
        }

        // 回覆訊息
        try {
          await axios.post(
            'https://api.line.me/v2/bot/message/reply',
            {
              replyToken: event.replyToken,
              messages: [{ type: 'text', text: replyMessage }]
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_CONFIG.channelAccessToken}`
              }
            }
          );
          console.log('已回覆訊息給用戶');
        } catch (error) {
          console.error('回覆訊息失敗:', error.message);
        }
      }
    }

    return res.status(200).send('OK');
  });

/**
 * 清理並重建巡檢點（一次性使用）
 * URL: https://asia-east1-factory-inspection-system.cloudfunctions.net/cleanupInspectionPoints
 */
exports.cleanupInspectionPoints = functions
  .region('asia-east1')
  .https
  .onRequest(async (req, res) => {
    console.log('開始清理巡檢點資料...');

    const NEW_POINTS = [
      { id: 'building-a', name: 'A棟' },
      { id: 'building-b', name: 'B棟' },
      { id: 'outdoor-area', name: '外廠區' }
    ];

    try {
      const db = admin.firestore();

      // 1. 刪除所有現有巡檢點
      const snapshot = await db.collection('inspectionPoints').get();
      const deletePromises = snapshot.docs.map(doc => doc.ref.delete());
      await Promise.all(deletePromises);
      console.log(`已刪除 ${snapshot.size} 個舊巡檢點`);

      // 2. 建立新的 3 個區域
      for (const point of NEW_POINTS) {
        await db.collection('inspectionPoints').doc(point.id).set({
          name: point.name,
          status: 'pending',
          inspectorName: null,
          timestamp: null
        });
      }
      console.log('已建立 3 個新巡檢區域');

      // 3. 清理今天的通知紀錄
      const today = new Date();
      const taipeiTime = new Date(today.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
      const todayStr = `${taipeiTime.getFullYear()}-${String(taipeiTime.getMonth() + 1).padStart(2, '0')}-${String(taipeiTime.getDate()).padStart(2, '0')}`;

      const areaNotifs = await db.collection('area_completion_notifications').where('date', '==', todayStr).get();
      await Promise.all(areaNotifs.docs.map(doc => doc.ref.delete()));

      const completeNotifs = await db.collection('completion_notifications').where('date', '==', todayStr).get();
      await Promise.all(completeNotifs.docs.map(doc => doc.ref.delete()));

      console.log('已清理今天的通知紀錄');

      return res.status(200).json({
        success: true,
        message: '清理完成！',
        deletedPoints: snapshot.size,
        newPoints: NEW_POINTS.map(p => p.name)
      });

    } catch (error) {
      console.error('清理失敗:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

// 匯入定時重置功能
const scheduledReset = require('./scheduledReset');
exports.dailyResetInspectionPoints = scheduledReset.dailyResetInspectionPoints;

// 匯入巡檢紀錄同步功能
const onStandardInspection = require('./onStandardInspection');
exports.onStandardInspectionCreated = onStandardInspection.onStandardInspectionCreated;
exports.onStandardInspectionUpdated = onStandardInspection.onStandardInspectionUpdated;

const onAcetyleneInspection = require('./onAcetyleneInspection');
exports.onAcetyleneInspectionCreated = onAcetyleneInspection.onAcetyleneInspectionCreated;

// 匯入巡檢完成檢測功能
const onInspectionComplete = require('./onInspectionComplete');
exports.onInspectionPointUpdated = onInspectionComplete.onInspectionPointUpdated;
