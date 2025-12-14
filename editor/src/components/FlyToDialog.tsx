import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { MapController } from "../utils/MapController";
import BaseDialog from "./BaseDialog";
import UrlParserDialog from "./UrlParserDialog";

type Props = {
  mapController: MapController;
  isOpen: boolean;
  setIsOpen(isOpen: boolean): void;
};

export default function FlyToDialog(props: Props): JSX.Element {
  const { t } = useTranslation();
  const { isOpen, setIsOpen, mapController } = props;
  const [coordinates, setCoordinatesState] = useState("");
  const [coordError, setCoordError] = useState("");
  const [isUrlParserOpen, setIsUrlParserOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const mapViewController = mapController.getMapViewController();
      const center = mapViewController?.getCenter();
      if (center) {
        setCoordinates(`${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}, ${center.zoom.toFixed(2)}`);
      }
    }
  }, [isOpen, mapController]);

  function closeModal() {
    setIsOpen(false);
  }

  function validateCoordinates(val: string): boolean {
    if (!val.trim()) return false;
    const parts = val.split(",");
    if (parts.length < 2 || parts.length > 3) return false;
    // Regex for integer or decimal, no scientific notation, no letters
    const numRegex = /^-?\d+(\.\d+)?$/;
    return parts.every((part) => numRegex.test(part.trim()));
  }

  function setCoordinates(val: string) {
    setCoordinatesState(val);
    if (!val) {
      setCoordError("");
      return;
    }
    if (validateCoordinates(val)) {
      setCoordError("");
    } else {
      setCoordError(String(t("fly-to-error-invalid-format")));
    }
  }

  function handleConfirm() {
    const parts = coordinates.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      const lat = parts[0];
      const lng = parts[1];
      const zoom = parts.length >= 3 ? parts[2] : undefined;
      mapController.getMapViewController()?.flyTo(lng, lat, zoom);
      closeModal();
    } else {
      setCoordError(String(t("fly-to-error-invalid-coordinates")));
    }
  }

  function handleUrlParserConfirm(lat: number, lng: number, zoom?: number) {
    mapController.getMapViewController()?.flyTo(lng, lat, zoom);
    setIsUrlParserOpen(false);
    closeModal();
  }

  return (
    <>
      <BaseDialog
        isOpen={isOpen}
        onClose={closeModal}
        title={t("fly-to")}
        footer={
          <div className="flex justify-between items-center">
            <button
              type="button"
              className="inline-flex justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500"
              onClick={() => setIsUrlParserOpen(true)}
            >
              {t("fly-to-url-parser")}
            </button>
            <div className="flex space-x-3">
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
          </div>
        }
      >
        <label className="block text-sm font-medium text-gray-700">{t("fly-to-coordinates")}</label>
        <input
          type="text"
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
          value={coordinates}
          onChange={(e) => setCoordinates(e.target.value)}
        />
        {coordError && <p className="mt-2 text-sm text-red-600">{coordError}</p>}
      </BaseDialog>

      <UrlParserDialog isOpen={isUrlParserOpen} setIsOpen={setIsUrlParserOpen} onConfirm={handleUrlParserConfirm} />
    </>
  );
}
