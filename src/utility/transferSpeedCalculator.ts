import { createSignal, Accessor, Setter } from "solid-js";

const HISTORY_TIME_LENGTH_MS = 1000; // Over how much time will the speed calculation be averaged over
const UPDATE_INTERVAL_MS = 250; // How often the speed gets updated

type HistoryEntry = {
  deltaBytes: number,
  timeAdded: number
};

class TransferSpeedCalculator {
  private history: HistoryEntry[] = [];
  private speedSetter!: Setter<number>;
  private speedGetter!: Accessor<number>;

  private update() {
    const nowTime = Date.now();
    let transferredBytesTotal = 0;

    this.history.forEach((entry, index) => {
      if (nowTime - entry.timeAdded > HISTORY_TIME_LENGTH_MS) {
        // Remove old entries
        this.history.splice(index, 1);
      } else {
        transferredBytesTotal += entry.deltaBytes;
      }
    });

    // Average the transfer speed
    const averageSpeed = transferredBytesTotal / (HISTORY_TIME_LENGTH_MS / 1000);
    this.speedSetter(averageSpeed);
  };

  constructor() {
    const [ getter, setter ] = createSignal<number>(0);
    this.speedGetter = getter;
    this.speedSetter = setter;

    setInterval(() => this.update(), UPDATE_INTERVAL_MS);
  }

  appendDeltaBytes(deltaBytes: number): void {
    this.history.push({
      deltaBytes: deltaBytes,
      timeAdded: Date.now()
    });
  }

  get getSpeedGetter(): Accessor<number> {
    return this.speedGetter;
  }
};

export {
  TransferSpeedCalculator
}

/*

let previousTotalUploadedBytes = 0;
let previousTotalDownloadedBytes = 0;
let totalUploadedBytes = 0;
let totalDownloadedBytes = 0;
let uploadDeltaBytesHistory: number[] = [];
let downloadDeltaBytesHistory: number[] = [];
let speedHistoryIdCounter = 0;
const lastTransferTransferredBytesDictionary: { [key: string]: number } = {};

const transferSpeedMenuEntryUpdateDelayMs = 250;
const historyLength = 5;

setInterval(() => {
  const deltaUploadBytes = totalUploadedBytes - previousTotalUploadedBytes;
  previousTotalUploadedBytes = totalUploadedBytes;

  const deltaDownloadBytes = totalDownloadedBytes - previousTotalDownloadedBytes;
  previousTotalDownloadedBytes = totalDownloadedBytes;

  // Set entry
  speedHistoryIdCounter++;

  // Update
  {
    uploadDeltaBytesHistory[speedHistoryIdCounter % historyLength] = deltaUploadBytes;

    // Calculate average speed over the history
    let average = 0;
    uploadDeltaBytesHistory.forEach(v => { average += v });
    average /= uploadDeltaBytesHistory.length;

    // Normalise to per second speeds
    average /= (transferSpeedMenuEntryUpdateDelayMs / 1000);

    setCurrentUploadSpeed(average == 0 ? -1 : average); // TODO: if zero bytes per second, dont hide! only if there is NO uploads being done, or downloads, then set to -1 to hide!
  }

  {
    downloadDeltaBytesHistory[speedHistoryIdCounter % historyLength] = deltaDownloadBytes;

    // Calculate average speed over the history
    let average = 0;
    downloadDeltaBytesHistory.forEach(v => { average += v });
    average /= downloadDeltaBytesHistory.length;

    // Normalise to per second speeds
    average /= (transferSpeedMenuEntryUpdateDelayMs / 1000);

    setCurrentDownloadSpeed(average == 0 ? -1 : average);
  }
}, transferSpeedMenuEntryUpdateDelayMs);

*/