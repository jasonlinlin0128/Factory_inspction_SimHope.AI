const functions = require('firebase-functions');
const admin = require('firebase-admin');
const sheetsService = require('./sheetsService');

// 巡檢點名稱對照
const pointNames = {
  'crane-1': '天車-1',
  'crane-2': '天車-2',
  'crane-3': '天車-3',
  'crane-4': '天車-4',
  'crane-5': '天車-5',
  'hook-safety': '吊鉤安全高度',
  'emergency-stop': '急停開關',
  'factory-lights': '工廠電燈'
};

/**
 * 標準巡檢紀錄觸發器
 * 當 standard_inspection_log 新增文件時自動同步到 Google Sheets
 */
exports.onStandardInspectionCreated = functions
  .region('asia-east1')
  .firestore
  .document('standard_inspection_log/{logId}')
  .onCreate(async (snapshot, context) => {
    const data = snapshot.data();

    try {
      console.log('偵測到新的標準巡檢紀錄:', context.params.logId);

      // 準備同步到 Google Sheets 的資料
      const sheetData = {
        timestamp: data.timestamp,
        pointId: data.pointId,
        pointName: pointNames[data.pointId] || data.pointId,
        inspectorName: data.inspectorName,
        deviceInfo: data.deviceInfo || {},
        webauthnVerified: data.webauthnVerified || false
      };

      // 同步到 Google Sheets
      const success = await sheetsService.logStandardInspection(sheetData);

      if (success) {
        console.log(`標準巡檢紀錄已同步到 Google Sheets: ${data.pointId}`);
      } else {
        console.warn('Google Sheets 同步失敗（可能未設定 Service Account）');
      }

      return null;

    } catch (error) {
      console.error('處理標準巡檢紀錄時發生錯誤:', error);
      // 不拋出錯誤，避免影響主要巡檢流程
      return null;
    }
  });
