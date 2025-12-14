const { google } = require('googleapis');
const functions = require('firebase-functions');

// Google Sheets 設定
const SPREADSHEET_ID = '10nPLV9odFIUcHZmupjHL_W2h6U5pglL06zBP_NM10sI';
const SHEET_NAME = '正式巡檢數據'; // 根據實際分頁名稱調整

/**
 * 建立 Google Sheets 客戶端
 * 使用 Service Account 認證
 */
function getSheetsClient() {
  try {
    // 直接從本地檔案讀取 Service Account
    const serviceAccount = require('./service-account.json');

    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    return google.sheets({ version: 'v4', auth });
  } catch (error) {
    console.error('建立 Sheets 客戶端失敗:', error);
    console.error('請確認 service-account.json 檔案存在於 functions 目錄中');
    return null;
  }
}

/**
 * 格式化日期時間（台北時間 UTC+8）
 */
function formatDateTime(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * 寫入資料到 Google Sheets
 * @param {Array<Array>} rows - 要寫入的資料列
 */
async function appendToSheet(rows) {
  const sheets = getSheetsClient();
  if (!sheets) {
    console.log('無法連接 Google Sheets，跳過同步');
    return false;
  }

  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:Z`,
      valueInputOption: 'RAW',
      resource: {
        values: rows
      }
    });

    console.log(`成功寫入 ${rows.length} 筆資料到 Google Sheets`);
    return true;
  } catch (error) {
    console.error('寫入 Google Sheets 失敗:', error.message);
    return false;
  }
}

/**
 * 寫入標準巡檢紀錄
 */
async function logStandardInspection(data) {
  const row = [
    formatDateTime(data.timestamp),                 // A - 時間
    '標準巡檢',                                     // B - 類型
    data.pointName || data.pointId,                 // C - 巡檢點
    data.inspectorName,                             // D - 巡檢員/回報人
    data.deviceInfo?.browser || '',                 // E - 瀏覽器
    data.deviceInfo?.os || '',                      // F - 作業系統
    data.deviceInfo?.model || '',                   // G - 裝置型號
    data.status === 'abnormal' ? '異常' : '正常',  // H - 巡檢狀態
    data.description || '',                         // I - 異常描述
    data.hasImage || '否',                          // J - 照片
    '',                                             // K - 處理狀態（空白）
    '',                                             // L - 處理人（空白）
    '',                                             // M - 處理說明（空白）
  ];

  return await appendToSheet([row]);
}

/**
 * 更新標準巡檢紀錄
 * @param {Object} data - 更新後的資料
 * @param {Object} originalTimestamp - 原始時間戳記（用於尋找記錄）
 */
async function updateStandardInspection(data, originalTimestamp) {
  const sheets = getSheetsClient();
  if (!sheets) {
    console.log('無法連接 Google Sheets，跳過同步');
    return false;
  }

  try {
    // 讀取所有資料找到對應的巡檢記錄
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:M`,
    });

    const rows = response.data.values || [];

    // 尋找符合的資料列（根據時間、類型、巡檢點、巡檢員匹配）
    const targetTime = formatDateTime(originalTimestamp);
    const targetType = '標準巡檢';
    const targetPoint = data.pointName || data.pointId;
    const targetInspector = data.inspectorName;

    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {  // 從第 2 列開始（跳過表頭）
      const row = rows[i];
      if (row[0] === targetTime &&           // A欄 - 時間
          row[1] === targetType &&            // B欄 - 類型
          row[2] === targetPoint &&           // C欄 - 巡檢點
          row[3] === targetInspector) {       // D欄 - 巡檢員
        rowIndex = i + 1; // Sheets 的 row index 從 1 開始
        break;
      }
    }

    if (rowIndex === -1) {
      console.log('找不到對應的巡檢記錄');
      console.log('目標時間:', targetTime);
      console.log('目標巡檢點:', targetPoint);
      console.log('目標巡檢員:', targetInspector);
      return false;
    }

    console.log(`找到對應記錄於第 ${rowIndex} 列，準備更新`);

    // 更新巡檢狀態、異常描述、照片欄位（H, I, J）
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!H${rowIndex}:J${rowIndex}`,
      valueInputOption: 'RAW',
      resource: {
        values: [[
          data.status === 'abnormal' ? '異常' : '正常',  // H - 巡檢狀態
          data.description || '',                         // I - 異常描述
          data.hasImage || '否'                           // J - 照片
        ]]
      }
    });

    console.log(`成功更新標準巡檢記錄（第 ${rowIndex} 列）`);
    return true;
  } catch (error) {
    console.error('更新標準巡檢記錄失敗:', error.message);
    return false;
  }
}

/**
 * 寫入乙炔區巡檢紀錄
 */
async function logAcetyleneInspection(data) {
  const row = [
    formatDateTime(data.timestamp),      // A - 時間
    '乙炔區巡檢',                        // B - 類型
    '乙炔區',                            // C - 巡檢點
    data.inspectorName,                  // D - 巡檢員/回報人
    data.deviceInfo?.browser || '',      // E - 瀏覽器
    data.deviceInfo?.os || '',           // F - 作業系統
    data.deviceInfo?.model || '',        // G - 裝置型號
    '',                                  // H - 巡檢狀態（空白）
    '',                                  // I - 異常描述（空白）
    '是',                                // J - 照片（乙炔區必有照片）
    '',                                  // K - 處理狀態（空白）
    '',                                  // L - 處理人（空白）
    '',                                  // M - 處理說明（空白）
  ];

  return await appendToSheet([row]);
}

/**
 * 寫入異常回報
 */
async function logAbnormalReport(data) {
  const row = [
    formatDateTime(data.timestamp),      // A - 時間
    '異常回報',                          // B - 類型
    data.pointName || data.pointId,      // C - 巡檢點
    data.inspectorName,                  // D - 巡檢員/回報人
    data.deviceInfo?.browser || '',      // E - 瀏覽器
    data.deviceInfo?.os || '',           // F - 作業系統
    data.deviceInfo?.model || '',        // G - 裝置型號
    '',                                  // H - 巡檢狀態（空白）
    data.description || '',              // I - 異常描述
    data.imageBase64 ? '是' : '否',      // J - 照片
    '待處理',                            // K - 處理狀態
    '',                                  // L - 處理人（空白）
    '',                                  // M - 處理說明（空白）
  ];

  return await appendToSheet([row]);
}

/**
 * 更新異常處理狀態
 * 注意：這個函式會搜尋並更新現有資料列，比較複雜
 */
async function updateAbnormalResolution(data) {
  const sheets = getSheetsClient();
  if (!sheets) {
    console.log('無法連接 Google Sheets，跳過同步');
    return false;
  }

  try {
    // 讀取所有資料找到對應的異常回報
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:M`,
    });

    const rows = response.data.values || [];

    // 尋找符合的資料列（根據時間、巡檢點、回報人匹配）
    const targetTime = formatDateTime(data.timestamp);
    const targetPoint = data.pointName || data.pointId;
    const targetInspector = data.inspectorName;

    let rowIndex = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (row[1] === '異常回報' &&
          row[2] === targetPoint &&
          row[3] === targetInspector &&
          row[10] === '待處理') {  // K欄 - 處理狀態
        rowIndex = i + 1; // Sheets 的 row index 從 1 開始
        break;
      }
    }

    if (rowIndex === -1) {
      console.log('找不到對應的異常回報，新增一筆完整紀錄');
      // 新增完整紀錄（包含處理狀態）
      const row = [
        targetTime,                       // A - 時間
        '異常回報',                       // B - 類型
        targetPoint,                      // C - 巡檢點
        targetInspector,                  // D - 巡檢員/回報人
        data.deviceInfo?.browser || '',   // E - 瀏覽器
        data.deviceInfo?.os || '',        // F - 作業系統
        data.deviceInfo?.model || '',     // G - 裝置型號
        '',                               // H - 巡檢狀態（空白）
        data.description || '',           // I - 異常描述
        '',                               // J - 照片（空白）
        '已處理',                         // K - 處理狀態
        data.resolvedBy || '',            // L - 處理人
        data.resolution || '',            // M - 處理說明
      ];
      return await appendToSheet([row]);
    }

    // 更新處理狀態
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!K${rowIndex}:M${rowIndex}`,
      valueInputOption: 'RAW',
      resource: {
        values: [['已處理', data.resolvedBy || '', data.resolution || '']]
      }
    });

    console.log(`成功更新異常處理狀態（第 ${rowIndex} 列）`);
    return true;
  } catch (error) {
    console.error('更新異常處理狀態失敗:', error.message);
    return false;
  }
}

/**
 * 寫入每日重置紀錄
 */
async function logDailyReset(data) {
  const row = [
    formatDateTime(data.timestamp),
    '系統重置',
    `重置 ${data.resetCount} 個巡檢點`,
    '系統自動',
    '',
    '',
    '',
    '',
    '',
    data.status === 'success' ? '成功' : '失敗',
    '',
    data.error || '',
  ];

  return await appendToSheet([row]);
}

/**
 * 初始化試算表表頭（僅需執行一次）
 */
async function initializeSheetHeaders() {
  const headers = [
    '時間',
    '類型',
    '巡檢點',
    '巡檢員/回報人',
    '瀏覽器',
    '作業系統',
    '裝置型號',
    '巡檢狀態',
    '異常描述',
    '照片',
    '處理狀態',
    '處理人',
    '處理說明'
  ];

  const sheets = getSheetsClient();
  if (!sheets) {
    console.error('無法連接 Google Sheets');
    return false;
  }

  try {
    // 檢查是否已有表頭
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:M1`,
    });

    if (response.data.values && response.data.values.length > 0) {
      console.log('表頭已存在，跳過初始化');
      return true;
    }

    // 寫入表頭
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:M1`,
      valueInputOption: 'RAW',
      resource: {
        values: [headers]
      }
    });

    // 格式化表頭（粗體、背景色）
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [{
          repeatCell: {
            range: {
              sheetId: 351641162, // 你的 gid
              startRowIndex: 0,
              endRowIndex: 1,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.8, green: 0.8, blue: 0.8 },
                textFormat: { bold: true },
                horizontalAlignment: 'CENTER'
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
          }
        }]
      }
    });

    console.log('成功初始化 Google Sheets 表頭');
    return true;
  } catch (error) {
    console.error('初始化表頭失敗:', error.message);
    return false;
  }
}

module.exports = {
  logStandardInspection,
  updateStandardInspection,
  logAcetyleneInspection,
  logAbnormalReport,
  updateAbnormalResolution,
  logDailyReset,
  initializeSheetHeaders
};
