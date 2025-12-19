const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

// LINE 配置
const LINE_CONFIG = {
  channelAccessToken: 'c+EUNkjk5UErAmmB9wysCtztPsxWjmc5/LeJIwAhuTVlhP2Q6zamu991UlncDfPkY/nECvKl4x8oV3EzXQ9bIfmCLbqSK7y8MV4UiacHeDfE1RPiPK4ONIwcXa/NGI/3fkvbXEXFh7k59BjWZnTybgdB04t89/1O/w1cDnyilFU=',
  recipientUserIds: [
    'U460381680455ba3b30bcb01972fe0ffb',  // 主管
    'U30b5ef382e4ee80a91e6600b6f592e85'   // 老闆
  ]
};

/**
 * 發送 LINE 訊息（簡化版）
 */
async function sendLineMessage(userIds, message) {
  const recipients = Array.isArray(userIds) ? userIds : [userIds];

  const promises = recipients.map(async (userId) => {
    try {
      await axios.post(
        'https://api.line.me/v2/bot/message/push',
        {
          to: userId,
          messages: [{ type: 'text', text: message }]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LINE_CONFIG.channelAccessToken}`
          },
          timeout: 10000
        }
      );
      console.log(`✓ 完成通知發送成功 (${userId})`);
    } catch (error) {
      console.error(`✗ 完成通知發送失敗 (${userId}):`, error.message);
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
 * 檢查今天是否已發送完成通知
 */
async function hasNotificationSentToday(db) {
  const today = getTodayDateString();
  const snapshot = await db.collection('completion_notifications')
    .where('date', '==', today)
    .where('notificationSent', '==', true)
    .limit(1)
    .get();

  return !snapshot.empty;
}

/**
 * 記錄完成通知發送狀態
 */
async function recordCompletionNotification(db, totalPoints) {
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
 * 檢查所有巡檢點是否都已完成
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
 * Trigger: 當任一巡檢點狀態更新時檢查是否全部完成
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

    // 只在狀態變為 'inspected' 時觸發檢查
    if (after.status !== 'inspected') {
      console.log('狀態未變為 inspected，跳過檢查');
      return null;
    }

    // 如果狀態沒有變化（已經是 inspected），跳過
    if (before.status === 'inspected') {
      console.log('狀態沒有變化，跳過檢查');
      return null;
    }

    const db = admin.firestore();

    try {
      // 檢查今天是否已發送過完成通知
      const alreadySent = await hasNotificationSentToday(db);
      if (alreadySent) {
        console.log('今日已發送過完成通知，跳過');
        return null;
      }

      // 檢查所有巡檢點是否都已完成
      const { allComplete, totalPoints, inspectedPoints } = await checkAllInspectionsComplete(db);

      if (!allComplete) {
        console.log(`尚未全部完成，當前進度: ${inspectedPoints}/${totalPoints}`);
        return null;
      }

      console.log('✅ 所有巡檢點已完成，準備發送通知');

      // 建立完成通知訊息
      const now = new Date();
      const completionMessage = `
🎉 巡檢完成通知

所有 ${totalPoints} 個巡檢點已全部完成！

完成時間：${now.toLocaleString('zh-TW', {
  timeZone: 'Asia/Taipei',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
})}
最後完成點：${after.name || pointId}
巡檢員：${after.inspectorName || '未知'}

感謝辛苦的巡檢工作！
      `.trim();

      // 發送 LINE 通知
      await sendLineMessage(LINE_CONFIG.recipientUserIds, completionMessage);

      // 記錄完成通知（防重複）
      await recordCompletionNotification(db, totalPoints);

      console.log('完成通知處理完成');
      return null;

    } catch (error) {
      console.error('處理完成通知失敗:', error);
      // 不拋出錯誤，避免重試
      return null;
    }
  });
