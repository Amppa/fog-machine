import { useState } from "react";
import { useTranslation } from "react-i18next";
import BaseDialog from "./BaseDialog";
import { parseMapUrl } from "../utils/MapUrlUtils";

type Props = {
  isOpen: boolean;
  setIsOpen(isOpen: boolean): void;
  onConfirm(lat: number, lng: number, zoom?: number): void;
};

export default function UrlParserDialog(props: Props): JSX.Element {
  const { t } = useTranslation();
  const { isOpen, setIsOpen, onConfirm } = props;
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState("");
  const [parsedResult, setParsedResult] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
  } | null>(null);

  function handleUrlInputChange(val: string) {
    setUrlInput(val);
    if (!val) {
      setUrlError("");
      setParsedResult(null);
      return;
    }

    const parsed = parseMapUrl(val);
    if (parsed) {
      setParsedResult(parsed);
      setUrlError("");
    } else {
      setParsedResult(null);
      setUrlError(String(t("url-parser-error")));
    }
  }

  function handleConfirm() {
    if (parsedResult) {
      onConfirm(parsedResult.lat, parsedResult.lng, parsedResult.zoom);
      closeModal();
    } else if (urlInput) {
      // Try parsing again just in case
      const parsed = parseMapUrl(urlInput);
      if (parsed) {
        onConfirm(parsed.lat, parsed.lng, parsed.zoom);
        closeModal();
      } else {
        // If invalid, behave like Cancel (close parser, clear state)
        closeModal();
      }
    }
  }

  function closeModal() {
    setIsOpen(false);
    setUrlInput("");
    setUrlError("");
    setParsedResult(null);
  }

  return (
    <BaseDialog
      isOpen={isOpen}
      onClose={closeModal}
      title={t("url-parser-title")}
      zIndex={50}
      footer={
        <div className="flex justify-end space-x-3">
          <button
            type="button"
            className="inline-flex justify-center px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500"
            onClick={handleConfirm}
          >
            {t("confirm")}
          </button>
          <button
            type="button"
            className="inline-flex justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500"
            onClick={closeModal}
          >
            {t("cancel")}
          </button>
        </div>
      }
    >
      <label className="block text-sm font-medium text-gray-700">
        {t("url-parser-paste-url")}
      </label>
      <input
        type="text"
        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
        value={urlInput}
        onChange={(e) => handleUrlInputChange(e.target.value)}
        placeholder={String(t("url-parser-placeholder"))}
      />
      <p className="mt-2 text-xs text-gray-500">
        {t("url-parser-supports")}
      </p>
      {parsedResult && (
        <div className="mt-2 text-sm text-green-600">
          {t("url-parser-parsed")}: {parsedResult.lat.toFixed(6)},{" "}
          {parsedResult.lng.toFixed(6)}
          {parsedResult.zoom !== undefined
            ? `, ${t("url-parser-zoom")}: ${parsedResult.zoom}`
            : ""}
        </div>
      )}
      {urlError && (
        <p className="mt-2 text-sm text-red-600">{urlError}</p>
      )}
    </BaseDialog>
  );
}
