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
        status: data.status || 'normal',
        description: data.description || '',
        hasImage: data.imageBase64 ? '是' : '否'
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

/**
 * 標準巡檢紀錄更新觸發器
 * 當 standard_inspection_log 更新時自動同步到 Google Sheets
 */
exports.onStandardInspectionUpdated = functions
  .region('asia-east1')
  .firestore
  .document('standard_inspection_log/{logId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    try {
      console.log('偵測到標準巡檢紀錄更新:', context.params.logId);

      // 檢查是否有實質變更
      const statusChanged = before.status !== after.status;
      const descChanged = before.description !== after.description;
      const imageChanged = (before.imageBase64 ? '是' : '否') !== (after.imageBase64 ? '是' : '否');

      if (!statusChanged && !descChanged && !imageChanged) {
        console.log('無實質變更，跳過 Sheets 同步');
        return null;
      }

      console.log('變更內容:', {
        statusChanged,
        descChanged,
        imageChanged,
        oldStatus: before.status,
        newStatus: after.status
      });

      // 準備更新資料
      const sheetData = {
        timestamp: after.timestamp,
        pointId: after.pointId,
        pointName: pointNames[after.pointId] || after.pointId,
        inspectorName: after.inspectorName,
        deviceInfo: after.deviceInfo || {},
        status: after.status || 'normal',
        description: after.description || '',
        hasImage: after.imageBase64 ? '是' : '否'
      };

      // 更新 Google Sheets
      const success = await sheetsService.updateStandardInspection(
        sheetData,
        before.timestamp  // 用原始時間戳記尋找對應記錄
      );

      if (success) {
        console.log(`標準巡檢紀錄已更新到 Google Sheets: ${after.pointId}`);
      } else {
        console.warn('Google Sheets 更新失敗（可能找不到對應記錄）');
      }

      return null;

    } catch (error) {
      console.error('處理標準巡檢更新時發生錯誤:', error);
      return null;
    }
  });
