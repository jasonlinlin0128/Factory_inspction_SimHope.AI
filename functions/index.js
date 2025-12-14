const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const sheetsService = require('./sheetsService');

admin.initializeApp();

// 直接寫入 LINE Token（私有專案適用）
const LINE_TOKEN = 'c+EUNkjk5UErAmmB9wysCtztPsxWjmc5/LeJIwAhuTVlhP2Q6zamu991UlncDfPkY/nECvKl4x8oV3EzXQ9bIfmCLbqSK7y8MV4UiacHeDfE1RPiPK4ONIwcXa/NGI/3fkvbXEXFh7k59BjWZnTybgdB04t89/1O/w1cDnyilFU=';

/**
 * 發送 LINE Notify 通知
 * @param {string} token - LINE Notify Access Token
 * @param {string} message - 要發送的訊息
 */
async function sendLineNotify(token, message) {
  try {
    console.log('準備發送 LINE 通知...');
    const response = await axios.post('https://notify-api.line.me/api/notify',
      `message=${encodeURIComponent(message)}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Bearer ${token}`
        },
        timeout: 10000
      }
    );
    console.log('LINE 通知發送成功，狀態碼:', response.status);
    return true;
  } catch (error) {
    console.error('LINE 通知發送失敗:', error.message);
    if (error.response) {
      console.error('HTTP 狀態碼:', error.response.status);
      console.error('回應內容:', error.response.data);
    }
    // 不拋出錯誤，讓 Function 繼續執行 Sheets 同步
    return false;
  }
}

/**
 * Trigger 1: 新異常回報時自動發送通知給主管
 * 當 abnormal_reports collection 新增文件時觸發
 */
exports.onAbnormalReportCreated = functions
  .region('asia-east1')
  .firestore
  .document('abnormal_reports/{reportId}')
  .onCreate(async (snapshot, context) => {
    const report = snapshot.data();

    console.log('偵測到新異常回報:', context.params.reportId);

    const message = `
⚠️ 新異常回報
巡檢點：${report.pointName}
回報人：${report.inspectorName}
時間：${report.timestamp.toDate().toLocaleString('zh-TW', { hour12: false })}

異常描述：
${report.description}

請儘速安排處理。
    `.trim();

    try {
      // 發送 LINE 通知
      await sendLineNotify(LINE_TOKEN, message);

      // 同步到 Google Sheets
      await sheetsService.logAbnormalReport({
        timestamp: report.timestamp,
        pointId: report.pointId,
        pointName: report.pointName,
        inspectorName: report.inspectorName,
        deviceInfo: report.deviceInfo || {},
        description: report.description
      });

      // 更新文件，標記通知已發送
      await snapshot.ref.update({ notificationSent: true });

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

        // 只標記處理完成通知已發送（實際不發 LINE 通知）
        await change.after.ref.update({ resolutionNotificationSent: true });
        console.log('異常處理狀態已更新');
      } catch (error) {
        console.error('更新狀態失敗:', error);
      }
    }
  });

// 匯入定時重置功能
const scheduledReset = require('./scheduledReset');
exports.dailyResetInspectionPoints = scheduledReset.dailyResetInspectionPoints;

// 匯入巡檢紀錄同步功能
const onStandardInspection = require('./onStandardInspection');
exports.onStandardInspectionCreated = onStandardInspection.onStandardInspectionCreated;

const onAcetyleneInspection = require('./onAcetyleneInspection');
exports.onAcetyleneInspectionCreated = onAcetyleneInspection.onAcetyleneInspectionCreated;
