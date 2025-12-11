import { useTranslation } from "react-i18next";
import BaseDialog from "./components/BaseDialog";
import { readFileAsync } from "./Utils";
import { MapController } from "./utils/MapController";
import { useDropzone } from "react-dropzone";
import { importGpxToFogMap } from "./utils/GpxImport";
import { importKmlToFogMap, importKmzToFogMap } from "./utils/KmlImport";
import { Bbox } from "./utils/CommonTypes";

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
                const extension = getFileExtension(file.name);
                const data = await readFileAsync(file);

                let newMap;
                let boundingBox: Bbox | null = null;

                if (extension === "gpx") {
                    // Import GPX file
                    if (typeof data === "string") {
                        const result = importGpxToFogMap(data);
                        newMap = result.fogMap;
                        if (!firstCoordinate) firstCoordinate = result.firstCoordinate;
                        boundingBox = result.boundingBox;
                    } else if (data instanceof ArrayBuffer) {
                        // Convert ArrayBuffer to string
                        const decoder = new TextDecoder("utf-8");
                        const text = decoder.decode(data);
                        const result = importGpxToFogMap(text);
                        newMap = result.fogMap;
                        if (!firstCoordinate) firstCoordinate = result.firstCoordinate;
                        boundingBox = result.boundingBox;
                    } else {
                        throw new Error("Invalid data format for GPX file");
                    }
                } else if (extension === "kml") {
                    // Import KML file
                    if (typeof data === "string") {
                        const result = importKmlToFogMap(data);
                        newMap = result.fogMap;
                        if (!firstCoordinate) firstCoordinate = result.firstCoordinate;
                        boundingBox = result.boundingBox;
                    } else if (data instanceof ArrayBuffer) {
                        // Convert ArrayBuffer to string
                        const decoder = new TextDecoder("utf-8");
                        const text = decoder.decode(data);
                        const result = importKmlToFogMap(text);
                        newMap = result.fogMap;
                        if (!firstCoordinate) firstCoordinate = result.firstCoordinate;
                        boundingBox = result.boundingBox;
                    } else {
                        throw new Error("Invalid data format for KML file");
                    }
                } else if (extension === "kmz") {
                    // Import KMZ file
                    if (data instanceof ArrayBuffer) {
                        const result = await importKmzToFogMap(data);
                        newMap = result.fogMap;
                        if (!firstCoordinate) firstCoordinate = result.firstCoordinate;
                        boundingBox = result.boundingBox;
                    } else {
                        throw new Error("KMZ file must be read as ArrayBuffer");
                    }
                } else {
                    msgboxShow("error", "error-invalid-gps");
                    return;
                }

                // Merge bounding boxes
                if (boundingBox) {
                    if (!combinedBoundingBox) {
                        combinedBoundingBox = boundingBox;
                    } else {
                        combinedBoundingBox = Bbox.merge(combinedBoundingBox, boundingBox);
                    }
                }

                // Merge the imported map with existing map
                // We do this by merging the tiles
                const mergedTiles = { ...importedMap.tiles };
                Object.entries(newMap.tiles).forEach(([key, tile]) => {
                    if (mergedTiles[key]) {
                        // Merge blocks from both tiles
                        const mergedBlocks = {
                            ...mergedTiles[key].blocks,
                            ...tile.blocks,
                        };
                        // Create new tile with merged blocks
                        const Tile = (tile as any).constructor;
                        mergedTiles[key] = new Tile(
                            tile.filename,
                            tile.id,
                            tile.x,
                            tile.y,
                            mergedBlocks
                        );
                    } else {
                        mergedTiles[key] = tile;
                    }
                });

                // Create new FogMap with merged tiles
                const FogMapConstructor = (importedMap as any).constructor;
                importedMap = new FogMapConstructor(mergedTiles);
            }

            // Replace the fog map with the merged result
            mapController.replaceFogMap(importedMap);

            // Zoom to appropriate view
            if (combinedBoundingBox) {
                const isSinglePoint =
                    combinedBoundingBox.west === combinedBoundingBox.east &&
                    combinedBoundingBox.south === combinedBoundingBox.north;

                if (isSinglePoint) {
                    mapController.flyTo(
                        combinedBoundingBox.west,
                        combinedBoundingBox.south,
                        20
                    );
                } else {
                    mapController.fitBounds(combinedBoundingBox);
                }
            } else if (firstCoordinate) {
                // Fallback: if no bounding box, use firstCoordinate
                mapController.flyTo(firstCoordinate[0], firstCoordinate[1]);
            }

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
