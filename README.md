工廠 NFC 巡檢系統
這是一個完整的工廠 NFC 巡檢系統，使用 Web NFC API、Firebase Firestore 和 Tailwind CSS 建立。系統包含兩個部分：

管理儀表板 (index.html): 一個即時監控面板，顯示所有巡檢點的狀態。

NFC 掃描介面 (/scanner/index.html): 一個給現場人員使用的行動網頁，透過 NFC 掃描來更新巡檢狀態。

🚀 部署到 GitHub Pages 教學
您可以將此專案免費部署到 GitHub Pages。

步驟 1: 建立 GitHub Repository
登入您的 GitHub 帳號。

點擊右上角的 + 號，選擇 New repository。

為您的 Repository 命名（例如 nfc-inspection-system），並設定為 Public。

點擊 Create repository。

步驟 2: 上傳專案檔案
將本專案的三個檔案 (index.html, scanner/index.html, README.md) 下載到您的電腦。

在您的 GitHub Repository 頁面，點擊 Add file > Upload files。

將 index.html 和 README.md 拖曳到上傳區域。

接著，建立 scanner 資料夾：點擊 Add file > Create new file，在檔名欄位輸入 scanner/，GitHub 會自動幫您建立資料夾。接著輸入 index.html 作為檔名。

將 scanner/index.html 的程式碼貼到編輯器中。

完成後，點擊 Commit changes。

步驟 3: 啟用 GitHub Pages
在您的 Repository 頁面，點擊上方的 Settings 標籤。

在左側選單中，選擇 Pages。

在 Build and deployment 下的 Source 選項，選擇 Deploy from a branch。

在 Branch 選項，選擇 main 分支，資料夾選擇 /(root)，然後點擊 Save。

等待幾分鐘，GitHub Pages 就會部署完成。您會在頁面上方看到您的網站網址。

網站網址格式
儀表板網址: https://<您的GitHub用戶名>.github.io/<您的Repository名稱>/

掃描介面網址: https://<您的GitHub用戶名>.github.io/<您的Repository名稱>/scanner/

🔥 Firebase 設定教學
本系統使用 Google Firebase 的 Firestore 作為後端資料庫。

步驟 1: 建立 Firebase 專案
前往 Firebase 控制台。

點擊 新增專案，並為您的專案命名（例如 factory-nfc-system）。

依照畫面指示完成專案建立。

步驟 2: 啟用 Firestore 資料庫
在您的 Firebase 專案頁面，點擊左側選單的 建構 > Firestore Database。

點擊 建立資料庫。

選擇「以測試模式啟動」。這會允許任何人在初期讀寫您的資料庫，方便開發。注意：正式上線前請務必設定更嚴格的安全規則！

選擇離您最近的 Cloud Firestore 位置，然後點擊 啟用。

步驟 3: 取得 Firebase 設定物件 (firebaseConfig)
回到 Firebase 專案主頁，點擊 專案總覽。

在頁面中央，點擊網頁圖示 </> 來新增一個網頁應用程式。

為您的應用程式命名，然後點擊 註冊應用程式。

Firebase 會顯示一段程式碼，其中包含一個名為 firebaseConfig 的物件。這就是您需要的設定資訊！ 將它完整複製下來。它看起來像這樣：

const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "...",
  appId: "1:..."
};

步驟 4: 將 firebaseConfig 貼到程式碼中
您需要將剛剛複製的 firebaseConfig 物件，分別貼到 index.html 和 scanner/index.html 兩個檔案中。

打開 index.html 檔案。

找到 // TODO: 請在此貼上您的 Firebase 設定物件 這行註解。

將您的 firebaseConfig 物件貼在該位置。

打開 scanner/index.html 檔案。

同樣找到 // TODO: 請在此貼上您的 Firebase 設定物件 這行註解。

將您的 firebaseConfig 物件貼在該位置。

完成以上步驟後，重新上傳修改過的 index.html 和 scanner/index.html 到 GitHub，您的系統就可以正常運作了！

🏷️ NFC 標籤製作教學
您需要為每一個巡檢點製作一個實體的 NFC 標籤。

建議工具
NFC 標籤: 購買 NTAG213 或 NTAG215 規格的 NFC 貼紙或卡片。

手機 App:

Android: NFC Tools

iOS: NFC Tools

製作步驟
在手機上打開 NFC Tools App。

選擇 寫入 > 新增記錄。

選擇 文字 或 純文字。

在文字欄位中，精確地輸入巡檢點的 ID。例如，為「天車-1」製作標籤，您就應該輸入 crane-1。

點擊 確定，然後將您的手機靠近空白的 NFC 標籤，直到 App 顯示寫入成功。

為所有巡檢點重複此步驟，每個標籤對應一個 ID：

crane-1

crane-2

crane-3

crane-4

crane-5

hook-safety

emergency-stop

acetylene

factory-lights

現在，您的整個系統已經準備就緒！