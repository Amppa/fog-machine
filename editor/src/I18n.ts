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
          confirm: "Confirm",
          cancel: "Cancel",

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
          "export-description-gpx": "Export data in [GPX] format. [Experimental]",
          exporting: "Exporting",

          // ===== Import Dialog =====
          "import-dialog-description":
            'All your data will be handled locally.\n\nAccept data format:\n- The "Sync" folder.\n- Files in the "Sync" folder.\n- A zip archive contains the "Sync" folder.\n\n',
          "import-dialog-drag-and-drop": "drag and drop [Fog of World] sync data",
          "import-dialog-select": "Select manually",

          // ===== Import GPS Dialog =====
          "import-gps-dialog-description": "Import GPS track data from GPX, KML, or KMZ files.",
          "import-gps-dialog-drag-and-drop": "drag and drop GPS track files",
          "import-gps-success": "GPS track imported successfully",

          // ===== Export Messages =====
          "export-done-message":
            "Exported successfully.\n\nInstructions: \n1. Reset [Fog of World] app\n2. Copy the extracted Sync folder to your cloud folder.\n3. Re-sync [Fog of World] app.",
          "export-diff-done-message":
            "Differential export successful.\n\nInstructions:\n1. Reset [Fog of World] app\n2. Copy files from the extracted Sync folder to your cloud Sync folder, replacing files with the same name (keep other unchanged files)\n3. Re-sync [Fog of World] app.",
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
          confirm: "確認",
          cancel: "取消",

          // ===== 汇入 / 汇出 =====
          import: "导入",
          "import-description": "从 [世界迷雾] 中导入数据。",
          "import-gps": "汇入 GPS 轨迹",
          "import-gps-description": "从 GPX、KML 或 KMZ 档案汇入轨迹",
          "export-full": "完整导出",
          "export-full-description": "以 [世界迷雾] 的格式导出全部数据",
          "export-diff": "差异化导出",
          "export-diff-description": "仅导出已修改的 tiles",
          "export-gpx": "导出 GPX",
          "export-description-gpx": "以 [GPX] 的格式导出数据。[实验性功能]",
          exporting: "导出中",

          // ===== 汇入对话框 =====
          "import-dialog-description":
            '你的数据将完全在本地处理。\n\n接受的数据格式:\n- "Sync" 文件夹\n-  "Sync" 文件夹中的全部文件\n- 包含 "Sync" 文件夹的 zip 压缩包\n\n',
          "import-dialog-drag-and-drop": "拖入 [世界迷雾] 同步数据",
          "import-dialog-select": "手动选择",

          // ===== 汇入 GPS 对话框 =====
          "import-gps-dialog-description": "从 GPX、KML 或 KMZ 档案汇入 GPS 轨迹资料。",
          "import-gps-dialog-drag-and-drop": "拖入 GPS 轨迹档案",
          "import-gps-success": "GPS 轨迹汇入成功",

          // ===== 汇出讯息 =====
          "export-done-message":
            "导出成功。\n\n说明： \n1. 重置 [世界迷雾] app\n2. 将解压缩后的Sync资料夹複製云端资料夹中。\n3. [世界迷雾] app 重新同步。",
          "export-diff-done-message":
            "差异化导出成功。\n\n说明： \n1. 重置 [世界迷雾] app\n2. 解压缩后的Sync资料夹的文件，複製到云端的Sync资料夹中，取代同名档案（保留其他未变更的档案）\n3. [世界迷雾] app 重新同步。",
          "export-diff-no-changes": "没有变更需要导出。",
          "export-done-message-gpx": "导出成功。",

          // ===== 错误 & 提示 =====
          error: "错误",
          "error-already-imported": "无法多次导入 [世界迷雾] 数据。可通过刷新页面重置。",
          "error-invalid-format": "无效文件格式。",
          "error-failed-to-load-snapshot": "载入快照失败。",
          "error-invalid-gps": "无效的 GPS 档案格式",
          info: "提示",

          // ===== 地图设定 =====
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

          // ===== 座标跳转对话框 =====
          "fly-to": "座标跳转",
          "fly-to-coordinates": "座标 (纬度, 经度, 缩放)",
          "fly-to-url-parser": "贴上 URL 网址",
          "fly-to-error-invalid-format": "格式无效。必须是 '纬度, 经度' 或 '纬度, 经度, 缩放'。仅限数字。",
          "fly-to-error-invalid-coordinates": "座标格式无效。请使用：纬度, 经度, 缩放",

          // ===== URL 解析器对话框 =====
          "url-parser-title": "URL 解析器",
          "url-parser-paste-url": "贴上 URL 网址",
          "url-parser-placeholder": "https://...",
          "url-parser-supports": "支援 Google Maps、Apple Maps、OpenStreetMap、Bing Maps。",
          "url-parser-parsed": "已解析",
          "url-parser-zoom": "缩放等级",
          "url-parser-error": "无法解析 URL。请检查格式。",
        },
      },
    },
  });
export default i18n;
