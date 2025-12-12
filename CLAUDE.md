# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a factory NFC inspection system built with Web NFC API, Firebase Firestore, and Tailwind CSS. The system enables real-time monitoring of inspection points and allows field personnel to update inspection status via NFC scanning on mobile devices.

## System Architecture

The application consists of three main components:

### 1. Management Dashboard (`index.html`)
- Real-time monitoring interface displaying all inspection point statuses
- Shows pending abnormal reports section (dynamically visible when reports exist)
- **Abnormal Report Resolution**: Supervisors can mark reports as resolved with required fields (resolver name, resolution description)
- Displays inspection history for the last 7 days via modal
- Includes reset functionality for all inspection statuses
- Uses real-time Firebase listeners via `onSnapshot()` for live updates

### 2. NFC Scanner Interface (`scanner/` directory)
- Mobile-optimized interface for field personnel
- Three distinct pages:
  - `index.html`: Standard inspection point handler with abnormal report submission and "My Reports" viewer
  - `acetylene.html`: Special photo-based inspection interface for acetylene storage area with "My Reports" viewer
  - `set-name.html`: Inspector name setup page (first-time use only)
- **My Reports Feature**: Inspectors can view all their submitted abnormal reports and their resolution status

### 3. Data Flow
- Scanner pages update Firestore collections: `inspectionPoints`, `standard_inspection_log`, `acetylene_log`, `abnormal_reports`
- Dashboard listens to these collections and re-renders in real-time
- Inspector names stored in browser's `localStorage` (set once, persists across sessions)
- **LINE Notify Integration**: Firebase Cloud Functions automatically send LINE notifications when abnormal reports are created or resolved

### 4. Firebase Cloud Functions (`functions/` directory)
- **Purpose**: Automate LINE Notify notifications for abnormal reports
- **Functions**:
  - `onAbnormalReportCreated`: Triggers when a new abnormal report is submitted, sends notification to supervisor
  - `onAbnormalReportResolved`: Triggers when a report status changes from "reported" to "resolved", sends notification to the original reporter
- **Configuration**: LINE Notify token stored securely in Firebase Functions config
- **Region**: Deployed to `asia-east1` for optimal performance

## Firebase Firestore Structure

### Collections:
1. **inspectionPoints**: Current status of each inspection point
   - Fields: `name`, `status`, `inspectorName`, `timestamp`

2. **standard_inspection_log**: Historical records for standard points
   - Fields: `pointId`, `inspectorName`, `timestamp`

3. **acetylene_log**: Photo-based records for acetylene area
   - Fields: `inspectorName`, `imageBase64`, `timestamp`

4. **abnormal_reports**: Abnormality reports from inspectors
   - Fields:
     - `pointId`, `pointName`, `inspectorName`: Basic report information
     - `description`: Detailed description of the abnormality
     - `imageBase64`: Optional photo/video evidence
     - `timestamp`: When the report was created
     - `status`: `"reported"` (pending) or `"resolved"` (handled)
     - `resolvedBy`: Name of the person who resolved the issue (null when pending)
     - `resolvedAt`: Timestamp when resolved (null when pending)
     - `resolution`: Description of how the issue was resolved (null when pending)
     - `notificationSent`: Boolean flag to prevent duplicate notifications
     - `resolutionNotificationSent`: Boolean flag for resolution notifications

## Inspection Points

The system tracks 9 inspection points defined in the `inspectionPoints` array:
- `crane-1` to `crane-5` (天車-1 to 天車-5)
- `hook-safety` (吊鉤安全高度)
- `emergency-stop` (急停開關)
- `acetylene` (乙炔存放區) - requires photo verification
- `factory-lights` (工廠電燈)

## Important Implementation Details

### NFC Tag Workflow:
1. NFC tags contain plain text with inspection point IDs (e.g., "crane-1")
2. Scanner URL format: `scanner/index.html?id=<pointId>`
3. On first use, users are redirected to `set-name.html` with a `redirectUrl` parameter
4. After name setup, user is redirected back to the original inspection URL

### Image Handling:
- Photos are compressed to max 800px width at 70% JPEG quality
- Images stored as base64 strings in Firestore
- Used for: acetylene inspection logs and abnormal report evidence

### Special Acetylene Inspection:
- Requires mandatory photo upload (valve closure verification)
- Shows last 7 days of photo inspection history
- Has separate optional abnormal report section

### Dashboard Visual Indicators:
- Green border: inspected points
- Red border: pending points
- Yellow border with ring: points with pending abnormal reports

## Deployment

### Frontend Deployment
This is a static web application designed for GitHub Pages deployment:
- No build process required for HTML/CSS/JS files
- All dependencies loaded via CDN (Tailwind CSS, Firebase SDK, Google Fonts)
- Firebase config is directly embedded in HTML files

### Cloud Functions Deployment
Required for LINE Notify automatic notifications:

1. **Prerequisites**:
   - Install Node.js 18.x
   - Install Firebase CLI: `npm install -g firebase-tools`
   - Obtain LINE Notify Access Token from https://notify-bot.line.me/my/

2. **Configuration**:
   ```bash
   firebase login
   firebase functions:config:set line.supervisor_token="YOUR_LINE_TOKEN"
   ```

3. **Deploy**:
   ```bash
   cd functions
   npm install
   cd ..
   firebase deploy --only functions
   ```

4. **Verification**:
   - Check Firebase Console > Functions to ensure both functions are deployed
   - Test by submitting an abnormal report and checking LINE notifications

## Development Workflow

### Testing Locally:
Since this is pure HTML/JavaScript with no build step, you can:
- Open `index.html` directly in a browser for dashboard testing
- Use a local web server for NFC testing: `python -m http.server` or similar
- Note: Web NFC API requires HTTPS in production (works on localhost for testing)

### Modifying Firebase Configuration:
Firebase config appears in multiple files and must be updated in all:
1. `index.html` (Dashboard - line ~62-70)
2. `scanner/index.html` (Standard scanner - line ~54-62)
3. `scanner/acetylene.html` (Acetylene scanner - line ~63-71)
4. `.firebaserc` (Project ID for Cloud Functions deployment)

### Adding New Inspection Points:
1. Add entry to `inspectionPoints` array in `index.html` (line ~75-77)
2. Create corresponding NFC tag with the new point ID
3. Firestore documents will be created automatically on first scan

## Technical Constraints

- Web NFC API only works on Android Chrome/Edge (iOS not supported as of 2025)
- Firebase anonymous authentication is used (no user login required)
- Images stored as base64 in Firestore (consider size limits for large-scale deployments)
- All timestamps use Firebase `serverTimestamp()` for consistency
- LINE Notify token is stored in Firebase Functions config (not in client-side code for security)
- Cloud Functions are deployed to `asia-east1` region

## Cost Considerations

With Firebase Blaze (pay-as-you-go) plan:
- **Estimated monthly cost**: $0 for small-scale deployments (10-20 inspectors)
- **Free tier limits**:
  - Cloud Functions: 2 million invocations/month
  - Firestore reads: 50,000/day
  - Firestore writes: 20,000/day
- **LINE Notify**: Completely free (no API costs)

## Key Files for Maintenance

### Frontend Files:
- `index.html`: Management dashboard with abnormal resolution modal (lines 327-349)
- `scanner/index.html`: Standard inspection with abnormal reporting and "My Reports" (lines 36-45, 309-318)
- `scanner/acetylene.html`: Acetylene inspection with "My Reports" (lines 56-60, 316-325)

### Backend Files:
- `functions/index.js`: Cloud Functions for LINE notifications
- `functions/package.json`: Dependencies configuration
- `firebase.json`: Firebase project configuration
- `.firebaserc`: Project ID
