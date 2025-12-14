const functions = require('firebase-functions');
const admin = require('firebase-admin');
const sheetsService = require('./sheetsService');

/**
 * 每日凌晨 0 點 (Asia/Taipei) 重置所有巡檢點狀態
 * Cron 格式：分 時 日 月 週
 * "0 0 * * *" = 每天 00:00
 */
exports.dailyResetInspectionPoints = functions
  .region('asia-east1')
  .pubsub
  .schedule('0 0 * * *')
  .timeZone('Asia/Taipei')
  .onRun(async (context) => {
    const db = admin.firestore();

    try {
      console.log('開始執行每日重置任務...');

      // 取得所有巡檢點
      const pointsSnapshot = await db.collection('inspectionPoints').get();

      if (pointsSnapshot.empty) {
        console.log('沒有巡檢點需要重置');
        return null;
      }

      // 使用 batch 批次更新
      const batch = db.batch();
      let resetCount = 0;

      pointsSnapshot.forEach(doc => {
        batch.update(doc.ref, {
          status: 'pending',
          inspectorName: null,
          timestamp: null
        });
        resetCount++;
      });

      await batch.commit();

      // 記錄重置日誌
      const resetLog = await db.collection('reset_logs').add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        resetCount: resetCount,
        status: 'success'
      });

      // 同步到 Google Sheets
      await sheetsService.logDailyReset({
        timestamp: admin.firestore.Timestamp.now(),
        resetCount: resetCount,
        status: 'success'
      });

      console.log(`成功重置 ${resetCount} 個巡檢點`);
      return null;

    } catch (error) {
      console.error('重置失敗:', error);

      // 記錄失敗日誌
      await db.collection('reset_logs').add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'failed',
        error: error.message
      });

      // 同步失敗記錄到 Google Sheets
      try {
        await sheetsService.logDailyReset({
          timestamp: admin.firestore.Timestamp.now(),
          resetCount: 0,
          status: 'failed',
          error: error.message
        });
      } catch (sheetError) {
        console.error('同步失敗記錄到 Google Sheets 時出錯:', sheetError);
      }

      throw error;
    }
  });
