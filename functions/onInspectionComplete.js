const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

// LINE 配置
const LINE_CONFIG = {
  channelAccessToken: 'CGP/yRRpZzlFOpCqrYN3pMGP/AdfYj6Xaz1knjxJr5wWwzWRVwF8pkndiSChHYJG27cmk6sqkNp/L7QFIuevOJIlmTkqA1SuCKAK3oXTOk4ZUUFy0TdcAHXbYyICzs7s4dBOOXXRgmoTgUcKLbotZgdB04t89/1O/w1cDnyilFU=',
  recipientUserIds: [
    'Uf8d0ac749c7a7f4e8b19bb711713da7e',  // 主管
    'U3f549dade4b3c94f2d404426da73aa29'   // 老闆
  ]
};

// 區域名稱對照
const AREA_NAMES = {
  'building-a': 'A棟',
  'building-b': 'B棟',
  'outdoor-area': '外廠區'
};

/**
 * 發送 LINE 訊息（支援文字和圖片）
 * @param {string[]} userIds - 接收者 ID 陣列
 * @param {object[]} messages - 訊息陣列 (LINE message objects)
 */
async function sendLineMessage(userIds, messages) {
  const recipients = Array.isArray(userIds) ? userIds : [userIds];
  const messageArray = Array.isArray(messages) ? messages : [messages];

  const promises = recipients.map(async (userId) => {
    try {
      await axios.post(
        'https://api.line.me/v2/bot/message/push',
        {
          to: userId,
          messages: messageArray
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LINE_CONFIG.channelAccessToken}`
          },
          timeout: 15000
        }
      );
      console.log(`✓ 完成通知發送成功 (${userId}), 共 ${messageArray.length} 則訊息`);
    } catch (error) {
      console.error(`✗ 完成通知發送失敗 (${userId}):`, error.message);
      if (error.response) {
        console.error('錯誤詳情:', JSON.stringify(error.response.data));
      }
    }
  });

  await Promise.allSettled(promises);
}

/**
 * 獲取今天的日期字串（台北時間，格式：YYYY-MM-DD）
 */
function getTodayDateString() {
  const now = new Date();
  // 轉換為台北時間
  const taipeiTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const year = taipeiTime.getFullYear();
  const month = String(taipeiTime.getMonth() + 1).padStart(2, '0');
  const day = String(taipeiTime.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 獲取今天開始的時間戳（台北時間 00:00:00）
 */
function getTodayStartTimestamp() {
  const now = new Date();
  const taipeiTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  taipeiTime.setHours(0, 0, 0, 0);
  return taipeiTime;
}

/**
 * 檢查該區域今天是否已發送過完成通知
 */
async function hasAreaNotificationSentToday(db, pointId) {
  const today = getTodayDateString();
  const snapshot = await db.collection('area_completion_notifications')
    .where('date', '==', today)
    .where('pointId', '==', pointId)
    .limit(1)
    .get();

  return !snapshot.empty;
}

/**
 * 記錄區域完成通知發送狀態
 */
async function recordAreaCompletionNotification(db, pointId, areaName, inspectorName) {
  const today = getTodayDateString();
  await db.collection('area_completion_notifications').add({
    date: today,
    pointId: pointId,
    areaName: areaName,
    inspectorName: inspectorName,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    notificationSent: true
  });
}

/**
 * 獲取該區域今天尚未通知的異常回報
 */
async function getAbnormalReportsForArea(db, pointId) {
  const todayStart = getTodayStartTimestamp();

  const snapshot = await db.collection('abnormal_reports')
    .where('pointId', '==', pointId)
    .where('timestamp', '>=', todayStart)
    .orderBy('timestamp', 'asc')
    .get();

  const reports = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    // 只取得尚未包含在完成通知中的異常回報
    if (!data.notificationIncludedInCompletion) {
      reports.push({
        id: doc.id,
        itemName: data.itemName || '未知項目',
        description: data.description || '無描述',
        imageUrl: data.imageUrl || null  // 加入照片 URL
      });
    }
  });

  return reports;
}

/**
 * 標記異常回報的通知已包含在完成通知中
 */
async function markAbnormalReportsAsNotified(db, reportIds) {
  const batch = db.batch();
  for (const reportId of reportIds) {
    const ref = db.collection('abnormal_reports').doc(reportId);
    batch.update(ref, { notificationIncludedInCompletion: true });
  }
  await batch.commit();
}

/**
 * 檢查所有巡檢點是否都已完成（用於全部完成通知）
 */
async function checkAllInspectionsComplete(db) {
  const snapshot = await db.collection('inspectionPoints').get();

  if (snapshot.empty) {
    console.log('沒有找到任何巡檢點');
    return { allComplete: false, totalPoints: 0, inspectedPoints: 0 };
  }

  let totalPoints = 0;
  let inspectedPoints = 0;

  snapshot.forEach(doc => {
    totalPoints++;
    const data = doc.data();
    if (data.status === 'inspected') {
      inspectedPoints++;
    }
  });

  console.log(`巡檢進度: ${inspectedPoints}/${totalPoints}`);

  return {
    allComplete: totalPoints > 0 && inspectedPoints === totalPoints,
    totalPoints: totalPoints,
    inspectedPoints: inspectedPoints
  };
}

/**
 * 記錄全部完成通知發送狀態
 */
async function recordAllCompleteNotification(db, totalPoints) {
  const today = getTodayDateString();
  await db.collection('completion_notifications').add({
    date: today,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    totalPoints: totalPoints,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    notificationSent: true
  });
}

/**
 * Trigger: 當任一巡檢點狀態更新時
 * - 發送該區域完成通知（包含異常項目）
 * - 檢查是否全部完成，若全部完成則發送總完成通知
 */
exports.onInspectionPointUpdated = functions
  .region('asia-east1')
  .firestore
  .document('inspectionPoints/{pointId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const pointId = context.params.pointId;

    console.log(`巡檢點 ${pointId} 狀態更新: ${before.status} → ${after.status}`);

    // 只在狀態變為 'inspected' 時觸發
    if (after.status !== 'inspected') {
      console.log('狀態未變為 inspected，跳過');
      return null;
    }

    // 如果狀態沒有變化（已經是 inspected），跳過
    if (before.status === 'inspected') {
      console.log('狀態沒有變化，跳過');
      return null;
    }

    const db = admin.firestore();
    const areaName = AREA_NAMES[pointId] || after.name || pointId;
    const now = new Date();
    const timeString = now.toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    try {
      // 檢查該區域今天是否已發送過通知
      const areaAlreadySent = await hasAreaNotificationSentToday(db, pointId);

      if (areaAlreadySent) {
        console.log(`${areaName} 今日已發送過區域完成通知，跳過`);
        return null;
      }

      // 等待 3 秒，確保異常報告的照片上傳完成
      console.log('等待照片上傳完成...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 獲取該區域今天的異常回報
      const abnormalReports = await getAbnormalReportsForArea(db, pointId);
      console.log(`${areaName} 有 ${abnormalReports.length} 個異常項目`);

      // 檢查是否全部完成
      const { allComplete, totalPoints, inspectedPoints } = await checkAllInspectionsComplete(db);

      // 構建訊息陣列（文字 + 圖片）
      const lineMessages = [];
      let textMessage;

      if (allComplete) {
        // 最後一區完成
        console.log(`🎉 ${areaName} 巡檢完成，且為最後一區，發送合併通知`);

        textMessage = `🎉 今日巡檢全部完成！

✅ ${areaName} 巡檢完成
巡檢員：${after.inspectorName || '未知'}
完成時間：${timeString}`;

        // 加入異常項目
        if (abnormalReports.length > 0) {
          textMessage += '\n';
          abnormalReports.forEach((report, index) => {
            textMessage += `\n⚠️ 異常項目${index + 1}：${report.itemName}`;
            textMessage += `\n異常描述：${report.description}`;
          });
        }

        textMessage += `\n\n所有 ${totalPoints} 個區域已全部完成巡檢。
感謝辛苦的巡檢工作！`;

        // 記錄全部完成通知
        await recordAllCompleteNotification(db, totalPoints);
      } else {
        // 非最後一區
        console.log(`✅ ${areaName} 巡檢完成，當前進度: ${inspectedPoints}/${totalPoints}`);

        textMessage = `✅ ${areaName} 巡檢完成

巡檢員：${after.inspectorName || '未知'}
完成時間：${timeString}`;

        // 加入異常項目
        if (abnormalReports.length > 0) {
          abnormalReports.forEach((report, index) => {
            textMessage += `\n\n⚠️ 異常項目${index + 1}：${report.itemName}`;
            textMessage += `\n異常描述：${report.description}`;
          });
        }

        textMessage += `\n\n今日進度：${inspectedPoints}/${totalPoints} 區`;
      }

      // 加入文字訊息
      lineMessages.push({ type: 'text', text: textMessage });

      // 加入異常照片（最多 4 張，因為 LINE 單次推送最多 5 則訊息）
      const reportsWithImages = abnormalReports.filter(r => r.imageUrl);
      const imagesToSend = reportsWithImages.slice(0, 4);

      if (imagesToSend.length > 0) {
        console.log(`附加 ${imagesToSend.length} 張異常照片`);
        imagesToSend.forEach(report => {
          lineMessages.push({
            type: 'image',
            originalContentUrl: report.imageUrl,
            previewImageUrl: report.imageUrl
          });
        });
      }

      // 發送 LINE 通知
      await sendLineMessage(LINE_CONFIG.recipientUserIds, lineMessages);

      // 標記異常回報已包含在完成通知中
      if (abnormalReports.length > 0) {
        const reportIds = abnormalReports.map(r => r.id);
        await markAbnormalReportsAsNotified(db, reportIds);
      }

      // 記錄區域完成通知（防重複）
      await recordAreaCompletionNotification(db, pointId, areaName, after.inspectorName);

      console.log(`${areaName} 通知已發送`);
      return null;

    } catch (error) {
      console.error('處理完成通知失敗:', error);
      // 不拋出錯誤，避免重試
      return null;
    }
  });
