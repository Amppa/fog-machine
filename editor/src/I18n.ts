import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    debug: true,
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    resources: {
      en: {
        translation: {
          // ===== Common =====
          "main-title": "FogMachine",
          language: "Language",
          "confirm": "Confirm",
          "cancel": "Cancel",

          // ===== Import / Export =====
          import: "Import",
          "import-description": "Import data from [Fog of World]",
          "import-gps": "Import GPS Tracks",
          "import-gps-description": "Import tracks from GPX, KML, or KMZ files",
          "export-full": "Full Export",
          "export-full-description": "Export all data in [Fog of World] format",
          "export-diff": "Differential Export",
          "export-diff-description": "Export only modified tiles",
          "export-gpx": "Export Gpx",
          "export-description-gpx":
            "Export data in [GPX] format. [Experimental]",
          "exporting": "Exporting",

          // ===== Import Dialog =====
          "import-dialog-description":
            'All your data will be handled locally.\n\nAccept data format:\n- The "Sync" folder.\n- Files in the "Sync" folder.\n- A zip archive contains the "Sync" folder.\n\n',
          "import-dialog-drag-and-drop":
            "drag and drop [Fog of World] sync data",
          "import-dialog-select": "Select manually",

          // ===== Import GPS Dialog =====
          "import-gps-dialog-description":
            "Import GPS track data from GPX, KML, or KMZ files.",
          "import-gps-dialog-drag-and-drop": "drag and drop GPS track files",
          "import-gps-success": "GPS track imported successfully",

          // ===== Export Messages =====
          "export-done-message":
            'Exported successfully.\n\nInstructions: \n1. Reset [Fog of World] app\n2. Copy the extracted Sync folder to your cloud folder.\n3. Re-sync [Fog of World] app.',
          "export-diff-done-message":
            'Differential export successful.\n\nInstructions:\n1. Reset [Fog of World] app\n2. Copy files from the extracted Sync folder to your cloud Sync folder, replacing files with the same name (keep other unchanged files)\n3. Re-sync [Fog of World] app.',
          "export-diff-no-changes": "No changes to export.",
          "export-done-message-gpx": "Exported successfully.",

          // ===== Errors & Info =====
          error: "Error",
          "error-already-imported":
            "You already imported data from [Fog of World]. Refresh the page if you want to start over.",
          "error-invalid-format": "Invalid format.",
          "error-failed-to-load-snapshot": "Failed to load snapshot.",
          "error-invalid-gps": "Invalid GPS file format",
          info: "Info",

          // ===== Map Settings =====
          "map-type": "Map type",
          "map-type-standard": "Standard",
          "map-type-satellite": "Satellite",
          "map-type-hybrid": "Hybrid",
          "map-type-none": "None",
          "map-projection": "Projection",
          // TODO: Why beta? This is a known bug[1] causing we render things accross meridian wrongly
          // in globe projection. We could workaround it by not rendering things across meridian
          // (e.g. having two canvas sources, one for each side).
          // But for now, I'm too lazy to do it, I'd rather wait for upstream's
          // fix or do it later and in a different PR.
          // [1] https://github.com/mapbox/mapbox-gl-js/issues/12758
          "map-projection-globe": "Globe[BETA]",
          "map-projection-mercator": "Mercator",
          "fog-concentration": "Fog concentration",
          "fog-concentration-low": "Low",
          "fog-concentration-medium": "Medium",
          "fog-concentration-high": "High",

          // ===== Fly To Dialog =====
          "fly-to": "Fly to",
          "fly-to-coordinates": "Coordinates (lat, lng, zoom)",
          "fly-to-url-parser": "URL Parser",
          "fly-to-error-invalid-format": "Invalid format. Must be 'lat, lng' or 'lat, lng, zoom'. Numbers only.",
          "fly-to-error-invalid-coordinates": "Invalid coordinates format. Use: lat, lng, zoom",

          // ===== URL Parser Dialog =====
          "url-parser-title": "URL Parser",
          "url-parser-paste-url": "Paste URL",
          "url-parser-placeholder": "https://...",
          "url-parser-supports": "Supports Google Maps, Apple Maps, OpenStreetMap, Bing Maps.",
          "url-parser-parsed": "Parsed",
          "url-parser-zoom": "Zoom level",
          "url-parser-error": "Could not parse URL. Please check the format.",
        },
      },
      zh: {
        translation: {
          // ===== 通用 =====
          "main-title": "迷雾机器",
          language: "语言",
          "confirm": "確認",
          "cancel": "取消",

          // ===== 匯入 / 匯出 =====
          import: "导入",
          "import-description": "从 [世界迷雾] 中导入数据。",
          "import-gps": "匯入 GPS 軌跡",
          "import-gps-description": "從 GPX、KML 或 KMZ 檔案匯入軌跡",
          "export-full": "完整導出",
          "export-full-description": "以 [世界迷雾] 的格式导出全部数据",
          "export-diff": "差異化導出",
          "export-diff-description": "僅導出已修改的 tiles",
          "export-gpx": "导出 GPX",
          "export-description-gpx": "以 [GPX] 的格式导出数据。[实验性功能]",
          "exporting": "导出中",

          // ===== 匯入對話框 =====
          "import-dialog-description":
            '你的数据将完全在本地处理。\n\n接受的数据格式:\n- "Sync" 文件夹\n-  "Sync" 文件夹中的全部文件\n- 包含 "Sync" 文件夹的 zip 压缩包\n\n',
          "import-dialog-drag-and-drop": "拖入 [世界迷雾] 同步数据",
          "import-dialog-select": "手动选择",

          // ===== 匯入 GPS 對話框 =====
          "import-gps-dialog-description":
            "從 GPX、KML 或 KMZ 檔案匯入 GPS 軌跡資料。",
          "import-gps-dialog-drag-and-drop": "拖入 GPS 軌跡檔案",
          "import-gps-success": "GPS 軌跡匯入成功",

          // ===== 匯出訊息 =====
          "export-done-message":
            '导出成功。\n\n說明： \n1. 重置 [世界迷雾] app\n2. 將解壓縮後的Sync資料夾複製雲端資料夾中。\n3. [世界迷霧] app 重新同步。',
          "export-diff-done-message":
            '差異化導出成功。\n\n說明： \n1. 重置 [世界迷雾] app\n2. 解壓縮後的Sync資料夾的文件，複製到雲端的Sync資料夾中，取代同名檔案（保留其他未變更的檔案）\n3. [世界迷霧] app 重新同步。',
          "export-diff-no-changes": "沒有變更需要導出。",
          "export-done-message-gpx": "导出成功。",

          // ===== 錯誤 & 提示 =====
          error: "错误",
          "error-already-imported":
            "无法多次导入 [世界迷雾] 数据。可通过刷新页面重置。",
          "error-invalid-format": "无效文件格式。",
          "error-failed-to-load-snapshot": "载入快照失败。",
          "error-invalid-gps": "無效的 GPS 檔案格式",
          info: "提示",

          // ===== 地圖設定 =====
          "map-type": "地图模式",
          "map-type-standard": "标准",
          "map-type-satellite": "卫星",
          "map-type-hybrid": "混合",
          "map-type-none": "无",
          "map-projection": "投影模式",
          "map-projection-globe": "球面[BETA]",
          "map-projection-mercator": "平面",
          "fog-concentration": "迷雾浓度",
          "fog-concentration-low": "低",
          "fog-concentration-medium": "中",
          "fog-concentration-high": "高",

          // ===== 座標跳轉對話框 =====
          "fly-to": "座標跳轉",
          "fly-to-coordinates": "座標 (緯度, 經度, 縮放)",
          "fly-to-url-parser": "貼上 URL 網址",
          "fly-to-error-invalid-format": "格式無效。必須是 '緯度, 經度' 或 '緯度, 經度, 縮放'。僅限數字。",
          "fly-to-error-invalid-coordinates": "座標格式無效。請使用：緯度, 經度, 縮放",

          // ===== URL 解析器對話框 =====
          "url-parser-title": "URL 解析器",
          "url-parser-paste-url": "貼上 URL 網址",
          "url-parser-placeholder": "https://...",
          "url-parser-supports": "支援 Google Maps、Apple Maps、OpenStreetMap、Bing Maps。",
          "url-parser-parsed": "已解析",
          "url-parser-zoom": "縮放等級",
          "url-parser-error": "無法解析 URL。請檢查格式。",
        },
      },
    },
  });
export default i18n;
