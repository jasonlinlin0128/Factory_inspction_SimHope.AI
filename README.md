🔥 第二階段：Firebase Storage 設定教學
為了支援拍照上傳功能，我們需要啟用 Firebase Storage。
步驟 1: 啟用 Firebase Storage
1. 在您的 Firebase 專案頁面，點擊左側選單的 建構 > Storage。
2. 點擊 開始使用。
3. 在跳出的安全性規則設定中，選擇「以測試模式啟動」，然後點擊 下一步。
4. 選擇離您最近的 Cloud Storage 位置，然後點擊 完成。
步驟 2: 設定 Storage 安全規則
啟用後，我們需要設定規則，確保只有您的應用程式可以上傳照片。
1. 在 Storage 頁面，點擊上方的 規則 分頁。
2. 將編輯器中的內容完全取代為以下規則：
rules_version = '2';
service firebase.storage {
 match /b/{bucket}/o {
   // 允許任何人讀取所有檔案 (方便顯示照片)
   match /{allPaths=**} {
     allow read;
   }
   // 僅允許已登入的使用者，上傳圖片到 'acetylene_inspections' 資料夾
   match /acetylene_inspections/{imageId} {
     allow write: if request.auth != null && request.resource.contentType.matches('image/.*');
   }
 }
}

3. 點擊 發布 以儲存您的新規則。
🏷️ NFC 標籤製作教學
... (此部分內容不變，故省略) ...
🌿 開發新功能 (Git 分支教學)
當您要開發新功能（例如第二階段的拍照功能）時，為了不影響到線上正在穩定運作的版本，建議使用「分支 (Branch)」。
   1. 建立新分支：
   * 在您的 GitHub 專案頁面，點擊左上方的 main 按鈕。
   * 在輸入框中，輸入新分支的名稱，例如 phase2-photo-upload。
   * 點擊 Create branch: ...。
   2. 在新分支上工作：
   * 請務必確認您目前位於新的分支 (phase2-photo-upload)。
   * 在此分支上進行所有新功能的檔案新增、修改與上傳。
   * 這樣可以確保 main 分支的程式碼永遠是第一階段的穩定版本。
