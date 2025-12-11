import { useTranslation } from "react-i18next";
import BaseDialog from "./components/BaseDialog";
import { readFileAsync } from "./Utils";
import { MapController } from "./utils/MapController";
import { useDropzone } from "react-dropzone";
import { importGpxToFogMap } from "./utils/GpxImport";
import { importKmlToFogMap, importKmzToFogMap } from "./utils/KmlImport";
import { Bbox } from "./utils/CommonTypes";
import { GpsImportResult } from "./utils/GpsImportTypes";
import { arrayBufferToString, mergeFogMaps } from "./utils/GpsImportUtils";

type Props = {
    mapController: MapController;
    isOpen: boolean;
    setIsOpen(isOpen: boolean): void;
    msgboxShow(title: string, msg: string): void;
};

function getFileExtension(filename: string): string {
    return filename.slice(
        (Math.max(0, filename.lastIndexOf(".")) || Infinity) + 1
    ).toLowerCase();
}

function convertToString(data: string | ArrayBuffer): string {
    if (typeof data === "string") {
        return data;
    }
    if (data instanceof ArrayBuffer) {
        return arrayBufferToString(data);
    }
    throw new Error("Invalid data format");
}

async function importGpsFile(file: File): Promise<GpsImportResult> {
    const extension = getFileExtension(file.name);
    const data = await readFileAsync(file);

    if (!data) {
        throw new Error("Failed to read file");
    }

    switch (extension) {
        case "gpx":
            return importGpxToFogMap(convertToString(data));
        case "kml":
            return importKmlToFogMap(convertToString(data));
        case "kmz":
            if (!(data instanceof ArrayBuffer)) {
                throw new Error("KMZ file must be read as ArrayBuffer");
            }
            return await importKmzToFogMap(data);
        default:
            throw new Error(`Unsupported file type: ${extension}`);
    }
}

export default function ImportGpsDialog(props: Props): JSX.Element {
    const { t } = useTranslation();
    const { isOpen, setIsOpen, msgboxShow } = props;

    async function importFiles(files: File[]) {
        const mapController = props.mapController;
        closeModal();

        if (files.length === 0) {
            msgboxShow("error", "error-invalid-gps");
            return;
        }

        try {
            let importedMap = mapController.fogMap;
            let firstCoordinate: [number, number] | null = null;
            let combinedBoundingBox: Bbox | null = null;

            for (const file of files) {
                const result = await importGpsFile(file);

                if (!firstCoordinate) {
                    firstCoordinate = result.firstCoordinate;
                }

                if (result.boundingBox) {
                    combinedBoundingBox = combinedBoundingBox
                        ? Bbox.merge(combinedBoundingBox, result.boundingBox)
                        : result.boundingBox;
                }

                importedMap = mergeFogMaps(importedMap, result.fogMap);
            }

            mapController.replaceFogMap(importedMap);
            mapController.zoomToBoundingBox(combinedBoundingBox, firstCoordinate);

            msgboxShow("info", "import-gps-success");
        } catch (error) {
            console.error("Error importing GPS file:", error);
            msgboxShow("error", "error-invalid-gps");
        }
    }

    const { open, getRootProps, getInputProps } = useDropzone({
        noClick: true,
        noKeyboard: true,
        onDrop: (files) => importFiles(files),
        accept: {
            "application/gpx+xml": [".gpx"],
            "application/vnd.google-earth.kml+xml": [".kml"],
            "application/vnd.google-earth.kmz": [".kmz"],
        },
    });
    const openFileSelector = open;

    function closeModal() {
        setIsOpen(false);
    }

    return (
        <BaseDialog
            isOpen={isOpen}
            onClose={closeModal}
            title={t("import-gps")}
        >
            <div className="mt-2">
                <p
                    className="text-sm text-gray-500"
                    style={{ whiteSpace: "pre-wrap" }}
                >
                    {t("import-gps-dialog-description")}
                </p>
            </div>
            <div className="pt-4">
                <div className="border-2 border-dashed border-gray-300 border-opacity-100 rounded-lg">
                    <div {...getRootProps({ className: "dropzone" })}>
                        <input {...getInputProps()} />
                        <div className="py-4 w-min mx-auto">
                            <div className="mb-4 whitespace-nowrap">
                                {t("import-gps-dialog-drag-and-drop")}
                            </div>
                            <div className="w-min mx-auto">
                                <button
                                    type="button"
                                    className="whitespace-nowrap px-4 py-2 text-sm font-medium text-blue-900 bg-blue-100 border border-transparent rounded-md hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500"
                                    onClick={openFileSelector}
                                >
                                    {t("import-dialog-select")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </BaseDialog>
    );
}
