const functions = require('firebase-functions');
const admin = require('firebase-admin');
const sheetsService = require('./sheetsService');

/**
 * 乙炔區巡檢紀錄觸發器
 * 當 acetylene_log 新增文件時自動同步到 Google Sheets
 */
exports.onAcetyleneInspectionCreated = functions
  .region('asia-east1')
  .firestore
  .document('acetylene_log/{logId}')
  .onCreate(async (snapshot, context) => {
    const data = snapshot.data();

    try {
      console.log('偵測到新的乙炔區巡檢紀錄:', context.params.logId);

      // 準備同步到 Google Sheets 的資料
      const sheetData = {
        timestamp: data.timestamp,
        inspectorName: data.inspectorName,
        deviceInfo: data.deviceInfo || {},
        webauthnVerified: data.webauthnVerified || false
      };

      // 同步到 Google Sheets
      const success = await sheetsService.logAcetyleneInspection(sheetData);

      if (success) {
        console.log('乙炔區巡檢紀錄已同步到 Google Sheets');
      } else {
        console.warn('Google Sheets 同步失敗（可能未設定 Service Account）');
      }

      return null;

    } catch (error) {
      console.error('處理乙炔區巡檢紀錄時發生錯誤:', error);
      // 不拋出錯誤，避免影響主要巡檢流程
      return null;
    }
  });
