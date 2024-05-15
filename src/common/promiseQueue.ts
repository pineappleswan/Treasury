// TODO: DEPRECATED!!!

/*

// ---- Why this class exists ---- //

Due to the chunk based nature of files, uploading and downloading requires transferring chunks sequentially.
However, downloading chunks one by one after the previous has finished has delay issues and so we need
to be able to transfer multiple chunks concurrently (but still more or less sequentially) so that the bandwidth
can be used utilised.

*/

import { sleepFor } from "./commonUtils";

const PROMISE_QUEUE_LOOP_DELAY_MS = 50;

// TODO: smarter without using intervals/delays and instead only try callbacks everytime a promise resolves instead
// TODO: document how this class works

class PromiseQueue {
	private nextPromise: (promiseId: number) => Promise<any>;
	private promiseResolveDataCallback: (...args: any[]) => void;
	private successCallback: () => void;
	private failCallback: (reason: string) => void;
	private maxConcurrentPromises: number;
	private promiseCount: number;
	private currentPromiseId: number = 0;
	private ranCount: number = 0;
	private resolvedCount: number = 0; // The number of promises that have been resolved
	private lastReturnedPromiseId: number = -1; // The id of the last promise that was send in the promiseResolveDataCallback()
	private busyCount: number = 0; // How many transfers are running concurrently
	private isRunningLoop = false;
	private resolveInOrder: boolean; // If true, promise queue will ensure that the resolving promise id is in sequential numerical order from the last resolved promise's id

	constructor(
		maxConcurrentPromises: number,
		promiseCount: number,
		resolveInOrder: boolean,
		nextPromise: (promiseId: number) => Promise<any>,
		promiseResolveDataCallback: (...args: any[]) => any,

		// Called when the queue is empty
		successCallback: () => void,

		// Called when a promise throws an error.
		failCallback: (reason: string) => void
	) {
		this.maxConcurrentPromises = maxConcurrentPromises;
		this.promiseCount = promiseCount;
		this.resolveInOrder = resolveInOrder;
		this.nextPromise = nextPromise;
		this.promiseResolveDataCallback = promiseResolveDataCallback;
		this.successCallback = successCallback;
		this.failCallback = failCallback;
	}

	// TODO: dont use interval like how buffered chunks are ordered on the server
	private tryCallResolveDataCallback(promiseId: number, ...args: any[]) {
		if (this.resolveInOrder) {
			const tryInterval = setInterval(() => {
				const dif = promiseId - this.lastReturnedPromiseId;

				if (dif == 1) { // The difference must be 1, therefore this promise must be the one that came immediately after the last one
					this.promiseResolveDataCallback(args);
					this.busyCount--;
					this.resolvedCount++;
					this.lastReturnedPromiseId = promiseId;
					clearInterval(tryInterval);
				}
			}, PROMISE_QUEUE_LOOP_DELAY_MS);
		} else {
			this.promiseResolveDataCallback(args);
			this.busyCount--;
			this.resolvedCount++;
			this.lastReturnedPromiseId = promiseId;
		}
	}

	get isLoopRunning() {
		return this.isRunningLoop;
	}

	async stop() {
		this.isRunningLoop = false;
	}

	async run() {
		this.isRunningLoop = true;

		return new Promise<void>(async (resolve) => {	
			while (this.isRunningLoop) {
				// Finish if all promises have been run
				if (this.resolvedCount == this.promiseCount) {
					this.successCallback();
					this.isRunningLoop = false;
					break;
				}
				
				if (this.busyCount < this.maxConcurrentPromises && this.ranCount < this.promiseCount) {
					const promiseId = this.currentPromiseId++;
					this.busyCount++;
					this.ranCount++;
	
					// Call next promise
					this.nextPromise(promiseId)
					.then((response) => {
						this.tryCallResolveDataCallback(promiseId, response);
					})
					.catch((error) => {
						this.failCallback(error);
					})
				}
	
				// Delay
				await sleepFor(PROMISE_QUEUE_LOOP_DELAY_MS);
			}

			resolve();
		});
	}
}

export {
	PromiseQueue
}
