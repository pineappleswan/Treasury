import { createSignal, Accessor, Setter } from "solid-js";

const HISTORY_TIME_LENGTH_MS = 2500; // Over how much time will the speed calculation be averaged over
const UPDATE_INTERVAL_MS = 250; // How often the speed gets updated

type HistoryEntry = {
	deltaBytes: number;
	timeAdded: number;
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
