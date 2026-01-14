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
    'U460381680455ba3b30bcb01972fe0ffb',  // 主管
    'U30b5ef382e4ee80a91e6600b6f592e85'   // 老闆
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
 * Trigger 1: 新異常回報時自動發送通知給主管（支援照片）
 * 當 abnormal_reports collection 新增文件時觸發
 */
exports.onAbnormalReportCreated = functions
  .region('asia-east1')
  .firestore
  .document('abnormal_reports/{reportId}')
  .onCreate(async (snapshot, context) => {
    const report = snapshot.data();

    console.log('偵測到新異常回報:', context.params.reportId);

    // 建立文字訊息（包含時區修正）
    const itemInfo = report.itemName ? `\n異常項目：${report.itemName}` : '';
    const textMessage = `
⚠️ 新異常回報
巡檢點：${report.pointName}${itemInfo}
回報人：${report.inspectorName}
時間：${report.timestamp.toDate().toLocaleString('zh-TW', {
  timeZone: 'Asia/Taipei',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
})}

異常描述：
${report.description}

請儘速安排處理。
    `.trim();

    try {
      // 準備要發送的訊息陣列
      const messagesToSend = [
        {
          type: 'text',
          text: textMessage
        }
      ];

      // 如果有照片，上傳並加入圖片訊息
      let imageUrl = null;
      if (report.imageBase64) {
        console.log('偵測到異常回報包含照片，準備上傳...');

        const fileName = `abnormal_${report.pointId}_${context.params.reportId}_${Date.now()}.jpg`;
        imageUrl = await sheetsService.uploadImageToStorage(report.imageBase64, fileName);

        if (imageUrl) {
          console.log('照片上傳成功，URL:', imageUrl);

          // 加入圖片訊息
          messagesToSend.push({
            type: 'image',
            originalContentUrl: imageUrl,
            previewImageUrl: imageUrl  // 使用相同的 URL 作為預覽圖
          });
        } else {
          console.warn('照片上傳失敗，將僅發送文字訊息');
        }
      }

      // 發送 LINE 通知給所有接收者（主管和老闆）
      await sendLineMessage(LINE_CONFIG.recipientUserIds, messagesToSend);

      // 同步到 Google Sheets
      await sheetsService.logAbnormalReport({
        timestamp: report.timestamp,
        pointId: report.pointId,
        pointName: report.pointName,
        inspectorName: report.inspectorName,
        deviceInfo: report.deviceInfo || {},
        description: report.description,
        imageBase64: report.imageBase64  // sheetsService 會自行處理照片上傳
      });

      // 更新文件，標記通知已發送，並儲存圖片 URL（如果有）
      const updateData = {
        notificationSent: true
      };
      if (imageUrl) {
        updateData.imageUrl = imageUrl;
      }
      await snapshot.ref.update(updateData);

      console.log('異常回報通知處理完成');
    } catch (error) {
      console.error('處理異常回報通知失敗:', error);
      // 即使通知失敗也不拋出錯誤，避免重試
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

/**
 * LINE Bot Webhook - 用於接收訊息並取得 User ID
 * Webhook URL: https://asia-east1-factory-inspection-system.cloudfunctions.net/lineWebhook
 */
exports.lineWebhook = functions
  .region('asia-east1')
  .https
  .onRequest(async (req, res) => {
    console.log('收到 LINE Webhook 請求');
    console.log('Request body:', JSON.stringify(req.body));

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
        const userName = event.source.type === 'user' ? '個人用戶' : event.source.type;
        const messageText = event.message.text;

        console.log('='.repeat(50));
        console.log('📱 收到 LINE 訊息');
        console.log('User ID:', userId);
        console.log('用戶類型:', userName);
        console.log('訊息內容:', messageText);
        console.log('='.repeat(50));
        console.log('');
        console.log('⚠️ 請將此 User ID 複製並更新到 LINE_CONFIG.supervisorUserId');
        console.log('');

        // 回覆訊息
        try {
          await axios.post(
            'https://api.line.me/v2/bot/message/reply',
            {
              replyToken: event.replyToken,
              messages: [
                {
                  type: 'text',
                  text: `✅ 已記錄您的 User ID\n\n您的 User ID 是：\n${userId}\n\n請將此 ID 提供給系統管理員。`
                }
              ]
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
