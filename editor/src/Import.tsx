import { useTranslation } from "react-i18next";
import BaseDialog from "./components/BaseDialog";
import { readFileAsync } from "./Utils";
import { MapController } from "./utils/MapController";
import { useDropzone } from "react-dropzone";
import JSZip from "jszip";
import { FogMap } from "./utils/FogMap";

type Props = {
  mapController: MapController;
  isOpen: boolean;
  setIsOpen(isOpen: boolean): void;
  msgboxShow(title: string, msg: string): void;
};

function getFileExtension(filename: string): string {
  return filename.slice(
    (Math.max(0, filename.lastIndexOf(".")) || Infinity) + 1
  );
}

export async function createMapFromZip(data: ArrayBuffer): Promise<FogMap> {
  const zip = await new JSZip().loadAsync(data);
  const tileFiles = await Promise.all(
    Object.entries(zip.files)
      .map(([filename, file]) => {
        filename = filename.replace(/^.*[\\/]/, "");
        return [filename, file] as [string, JSZip.JSZipObject];
      })
      .filter(([filename, _file]) => {
        return filename != "";
      })
      .map(async ([filename, file]) => {
        const data = await file.async("arraybuffer");
        return [filename, data] as [string, ArrayBuffer];
      })
  );
  const map = FogMap.createFromFiles(tileFiles);
  return map;
}

export default function MyModal(props: Props): JSX.Element {
  const { t } = useTranslation();
  const { isOpen, setIsOpen, msgboxShow } = props;

  async function importFiles(files: File[]) {
    const mapController = props.mapController;
    closeModal();
    if (mapController.fogMap !== FogMap.empty) {
      // we need this because we do not support overriding in `mapController.addFoGFile`
      msgboxShow("error", "error-already-imported");
      return;
    }

    console.log(files);
    // TODO: error handling
    // TODO: progress bar
    // TODO: improve file checking
    let done = false;
    files.forEach((file) => console.log(getFileExtension(file.name)));
    if (files.every((file) => getFileExtension(file.name) === "")) {
      const tileFiles = await Promise.all(
        files.map(async (file) => {
          const data = await readFileAsync(file);
          return [file.name, data] as [string, ArrayBuffer];
        })
      );
      const map = FogMap.createFromFiles(tileFiles);
      mapController.replaceFogMap(map);
      done = true;
    } else {
      if (files.length === 1 && getFileExtension(files[0].name) === "zip") {
        const data = await readFileAsync(files[0]);
        if (data instanceof ArrayBuffer) {
          const map = await createMapFromZip(data);
          mapController.replaceFogMap(map);
        }
        done = true;
      }
    }

    if (done) {
      // TODO: move to center?
    } else {
      msgboxShow("error", "error-invalid-format");
    }
  }

  const { open, getRootProps, getInputProps } = useDropzone({
    noClick: true,
    noKeyboard: true,
    onDrop: (files) => importFiles(files),
  });
  const openFileSelector = open;

  function closeModal() {
    setIsOpen(false);
  }

  return (
    <BaseDialog
      isOpen={isOpen}
      onClose={closeModal}
      title={t("import")}
    >
      <div className="mt-2">
        <p
          className="text-sm text-gray-500"
          style={{ whiteSpace: "pre-wrap" }}
        >
          {t("import-dialog-description")}
        </p>
      </div>
      <div className="pt-4">
        <div className="border-2 border-dashed border-gray-300 border-opacity-100 rounded-lg">
          <div {...getRootProps({ className: "dropzone" })}>
            <input {...getInputProps()} />
            <div className="py-4 w-min mx-auto">
              <div className="mb-4 whitespace-nowrap">
                {t("import-dialog-drag-and-drop")}
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
