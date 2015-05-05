import ReadableStream, { Source } from './ReadableStream';
import ReadableStreamController from './ReadableStreamController';
import WritableStream, { Sink } from './WritableStream';
import { Strategy } from './interfaces';
import Promise from '../Promise';

export interface Transform<R, W> {
	transform(chunk: W, enqueueInReadable: (chunk: R) => void, transformDone: () => void): void;
	flush(enqueue: Function, close: Function): void;
	writableStrategy: Strategy<W>;
	readableStrategy: Strategy<R>;
}

export default class TransformStream<R, W> {
	readable: ReadableStream<R>;
	writable: WritableStream<W>;

	constructor(args: Transform<R, W>) {
		let { transform, flush, writableStrategy, readableStrategy } = args;
		let writeChunk: W;
		let writeDone: () => void;
		let errorWritable: (error?: any) => void;
		let transforming = false;
		let chunkWrittenButNotYetTransformed = false;
		let enqueueInReadable: () => void;
		let closeReadable: (error?: any) => void;
		let errorReadable: (error?: any) => void;

		this.writable = new WritableStream<W>(<Sink <W>> {
			abort(): Promise<void> {
				return Promise.resolve();
			},

			start(error: (error?: any) => void) {
				errorWritable = error;
				return Promise.resolve();
			},

			write(chunk: W) {
				writeChunk = chunk;
				chunkWrittenButNotYetTransformed = true;
				var p = new Promise<void>(resolve => writeDone = resolve);
				maybeDoTransform();
				return p;
			},

			close(): Promise<void> {
				try {
					flush(enqueueInReadable, closeReadable);
					return Promise.resolve();
				} catch (e) {
					errorWritable(e);
					errorReadable(e);
					return Promise.reject(e);
				}
			}
		}, writableStrategy);

		this.readable = new ReadableStream(<Source <R>> {
			start(controller: ReadableStreamController<R>): Promise<void> {
				enqueueInReadable = controller.enqueue.bind(controller);
				closeReadable = controller.close.bind(controller);
				errorReadable = controller.error.bind(controller);
				return Promise.resolve();
			},

			pull(controller: ReadableStreamController<R>): Promise<void> {
				if (chunkWrittenButNotYetTransformed) {
					maybeDoTransform();
				}
				return Promise.resolve();
			},

			cancel(): Promise<void> {
				return Promise.resolve();
			}
		}, readableStrategy);

		function maybeDoTransform() {
			if (!transforming) {
				transforming = true;
				try {
					transform(writeChunk, enqueueInReadable, transformDone);
					writeChunk = undefined;
					chunkWrittenButNotYetTransformed = false;
				} catch (e) {
					transforming = false;
					errorWritable(e);
					errorReadable(e);
				}
			}
		}

		function transformDone() {
			transforming = false;
			writeDone();
		}
	}
}
