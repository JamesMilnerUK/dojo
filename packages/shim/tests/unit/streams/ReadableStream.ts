import * as assert from 'intern/chai!assert';
import * as registerSuite from 'intern!object';

import BaseStringSource from './helpers/BaseStringSource';
import ReadableStream, { State } from 'src/streams/ReadableStream';
import ReadableStreamController from 'src/streams/ReadableStreamController';
import { ReadResult, Strategy } from 'src/streams/interfaces';
import Promise from 'src/Promise';

var strategy: Strategy<string>;
var asyncTimeout = 1000;

registerSuite({
	name: 'ReadableStream',

	'constructor' : {

		'noSource'() {
			assert.throws(() => { new ReadableStream<string>(null); });
		},

		'simple source'() {
			var source = new BaseStringSource();
			assert.doesNotThrow(() => { new ReadableStream<string>(source); });
		},

		'verify start called'() {

			var dfd = this.async(asyncTimeout);
			var stream: ReadableStream<string>;

			// Make sure start is called.
			var source = new BaseStringSource();
			source.start = dfd.callback(() => {
				return Promise.resolve();
			});

			assert.doesNotThrow(() => stream = new ReadableStream<string>(source));
			setTimeout(dfd.rejectOnError(() => {
				assert.strictEqual(State.Readable, stream.state);
			}));
		},

		'verify pull called'() {

			var dfd = this.async(asyncTimeout);
			var stream: ReadableStream<string>;

			// Make sure start is called.
			var source = new BaseStringSource();
			source.pull = dfd.callback(() => {
				return Promise.resolve();
			});
			assert.doesNotThrow(() => { stream = new ReadableStream<string>(source); });
			setTimeout(dfd.rejectOnError(() => {
				assert.strictEqual(State.Readable, stream.state);
			}));
		},

		'source start rejects'() {
			var dfd = this.async(asyncTimeout);
			var source = new BaseStringSource();
			source.start = () => {
				return Promise.reject(new Error('test'));
			};

			var stream = new ReadableStream(source);
			setTimeout(dfd.callback(() => {
				assert.strictEqual(State.Errored, stream.state);
			}));
		},

		'source pull rejects'() {
			var dfd = this.async(asyncTimeout);
			var source = new BaseStringSource();
			source.pull = () => {
				return Promise.reject(new Error('test'));
			};

			var stream = new ReadableStream(source);
			setTimeout(dfd.callback(() => {
				assert.strictEqual(State.Errored, stream.state);
			}));
		}
	},

	'strategy': {
		beforeEach() {
			strategy = {
				size: (chunk: string) => { return 1; },
				highwaterMark: 2
			};
		},

		'default strategy'() {
			var source = new BaseStringSource();
			var stream = new ReadableStream<string>(source);
			assert.isNotNull(stream._strategy);
			assert.isUndefined(stream._strategy.size);
			assert.strictEqual(1, stream._strategy.highwaterMark);
		},

		'strategy'() {
			var stream: ReadableStream<string>;
			var source = new BaseStringSource();
			stream = new ReadableStream<string>(source, strategy);
			assert.isNotNull(stream._strategy);
			assert.isNotNull(stream._strategy.size);
			assert.strictEqual(2, stream._strategy.highwaterMark);
			assert.strictEqual(1, stream._strategy.size('test'));

			// changing the source's strategy does not affect the stream that has already been created.
			strategy = {
				size: (chunk: string) => { return 10; },
				highwaterMark: 25
			};
			assert.strictEqual(2, stream._strategy.highwaterMark);
			assert.strictEqual(1, stream._strategy.size('test'));
		},

		'strategy size() throw error'() {
			var source = new BaseStringSource();
			var strategy = {
				size: (chunk: string): number => { throw new Error('Size failure'); },
				highwaterMark: 2
			};

			var stream = new ReadableStream(source, strategy);
			assert.throws(() => { stream.enqueue('This is a test'); });
		}
	},

	'enqueue': {
		'enqueue stream not locked'() {
			var source = new BaseStringSource();
			var stream = new ReadableStream<string>(source, strategy);

			stream.enqueue('This is a test');
			assert.strictEqual(1, stream.queueSize);
		},

		'enqueue'() {
			var source = new BaseStringSource();
			var strategy: Strategy<string> = {
				size: (chunk: string) => { return 1; },
				highwaterMark: 2
			};
			var stream = new ReadableStream<string>(source, strategy);
			stream.getReader();

			assert.equal(2, stream.desiredSize);
			stream.enqueue('This is a test');
			assert.equal(1, stream.desiredSize);
			stream.enqueue('This is a test');
			assert.equal(0, stream.desiredSize);
			stream.enqueue('This is a test');
			assert.equal(0, stream.desiredSize);

			assert.strictEqual(3, stream.queueSize);
		},

		'enqueue size'() {
			var source = new BaseStringSource();
			var strategy: Strategy<string> = {
				size: (chunk: string) => { return 5; },
				highwaterMark: 15
			};
			var stream = new ReadableStream<string>(source, strategy);
			stream.getReader();

			stream.enqueue('This is a test');
			assert.equal(5, stream.queueSize);
		},

		'enqueue no size'() {
			var source = new BaseStringSource();
			var strategy: Strategy<string> = {
				size: undefined,
				highwaterMark: 15
			};
			var stream = new ReadableStream<string>(source, strategy);
			stream.getReader();

			stream.enqueue('This is a test');
			assert.equal(1, stream.queueSize);
		},

		'enqueue with read requests'() {
			var source = new BaseStringSource();
			var strategy: Strategy<string> = {
				size: (chunk: string) => { return 1; },
				highwaterMark: 2
			};
			var stream = new ReadableStream<string>(source, strategy);
			var reader = stream.getReader();
			// Mock reader's resolveReadRequest method.
			reader.resolveReadRequest = (chunk: string) => { return true; };
			assert.equal(2, stream.desiredSize);
			stream.enqueue('This is a test');
			assert.equal(2, stream.desiredSize);
		}
	},

	'error'() {
		var stream = new ReadableStream(new BaseStringSource(), strategy);
		stream.enqueue('test');
		assert.strictEqual(1, stream.queueSize);

		var error = new Error('test error');
		assert.doesNotThrow(() => { stream.error(error); });
		assert.strictEqual(error, stream._storedError);
		assert.strictEqual(0, stream.queueSize);
		assert.strictEqual(State.Errored, stream.state);

		assert.throws(() => { stream.error(error); });

		stream = new ReadableStream(new BaseStringSource(), strategy);
		var reader = stream.getReader();
		var released = false;
		reader.releaseLock = () => {
			released = true;
		};
		stream.error(error);
		assert.isTrue(released);
	},

	'getReader': {
		'get reader after error'() {
			var stream = new ReadableStream(new BaseStringSource(), strategy);
			assert.doesNotThrow(() => {
				stream.error(new Error());
			});
			assert.throws(() => {
				stream.getReader();
			});
		},

		'get reader when locked'() {
			var stream = new ReadableStream(new BaseStringSource(), strategy);
			assert.doesNotThrow(() => { stream.getReader(); });
			assert.throws(() => { stream.getReader(); });
		}
	},

	'isLocked'() {
		var stream = new ReadableStream(new BaseStringSource(), strategy);
		assert.isTrue(stream.hasSource);
		assert.isFalse(stream.locked);

	},

	'_requestClose'() {
		var stream = new ReadableStream(new BaseStringSource(), strategy);
		stream._requestClose();
		assert.equal(State.Closed, stream.state);
		stream._requestClose();
		assert.equal(State.Closed, stream.state);

		stream = new ReadableStream(new BaseStringSource(), strategy);
		stream.enqueue('test');
		stream._requestClose();
		assert.equal(State.Readable, stream.state);
	},

	'_close'() {
		var stream = new ReadableStream(new BaseStringSource(), strategy);
		stream._close();
		assert.equal(State.Closed, stream.state);
		stream._close();

		stream = new ReadableStream(new BaseStringSource(), strategy);
		stream.error(new Error('test'));
		stream._close();

		stream = new ReadableStream(new BaseStringSource(), strategy);
		stream.getReader();
		assert.isObject(stream._reader);
		stream._close();
		assert.isTrue(stream._reader == null);
	},

	'cancel': {
		'not readable'() {
			var dfd = this.async(asyncTimeout);
			var stream = new ReadableStream(new BaseStringSource(), strategy);
			stream._underlyingSource = null;
			stream.cancel().then(
				dfd.rejectOnError(() => { assert.fail(); }),
				dfd.callback((error: Error) => { assert.isObject(error); })
			);
		},

		'locked'() {
			var dfd = this.async(asyncTimeout);
			var stream = new ReadableStream(new BaseStringSource(), strategy);
			stream.getReader();
			assert.isTrue(stream.locked);
			stream.cancel().then(
				dfd.rejectOnError(() => { assert.fail(); }),
				dfd.callback((error: Error) => { assert.isObject(error); })
			);
		},

		'closed'() {
			var dfd = this.async(asyncTimeout);
			var stream = new ReadableStream(new BaseStringSource(), strategy);
			stream._requestClose();
			assert.equal(State.Closed, stream.state);
			stream.cancel().then(
				dfd.callback((value: any) => { assert.isUndefined(value); }),
				dfd.rejectOnError(() => { assert.fail(); })
			);
		},

		'errored'() {
			var dfd = this.async(asyncTimeout);
			var stream = new ReadableStream(new BaseStringSource(), strategy);
			stream.error(new Error('test'));
			assert.equal(State.Errored, stream.state);
			stream.cancel().then(
				dfd.rejectOnError(() => { assert.fail(); }),
				dfd.callback((error: Error) => { assert.isObject(error); })
			);
		},

		'populated queue'() {
			var dfd = this.async(asyncTimeout);
			var stream = new ReadableStream(new BaseStringSource(), strategy);
			stream.enqueue('test');
			assert.equal(1, stream.queueSize);
			assert.equal(State.Readable, stream.state);
			stream.cancel().then(
				dfd.callback(() => {
					assert.equal(0, stream.queueSize);
					assert.equal(State.Closed, stream.state);
				}),
				dfd.rejectOnError(() => { assert.fail(); })
			);
		},

		'verify cancel called on source'() {
			var dfd = this.async(asyncTimeout);
			var source = new BaseStringSource();
			source.cancel = dfd.callback(source.cancel);
			var stream = new ReadableStream(source, strategy);
			stream.cancel();
		}
	},

	'allowPull': {

		'started'() {
			var dfd = this.async(asyncTimeout);
			var stream = new ReadableStream(new BaseStringSource());
			stream.started.then(dfd.callback(() => {
				assert.isTrue(stream._allowPull);
			}));
		},

		'closed'() {
			var dfd = this.async(asyncTimeout);
			var stream = new ReadableStream(new BaseStringSource());
			stream.started.then(dfd.callback(() => {
				stream._close();
				assert.isFalse(stream._allowPull);
			}));
		},

		'closedRequested'() {
			var dfd = this.async(asyncTimeout);
			var stream = new ReadableStream(new BaseStringSource(), {
				highwaterMark: 10
			});
			stream.started.then(dfd.callback(() => {
				stream.enqueue('test');
				stream._requestClose();
				assert.isFalse(stream._allowPull);
			}));
		},

		'errored'() {
			var dfd = this.async(asyncTimeout);
			var stream = new ReadableStream(new BaseStringSource());
			stream.started.then(dfd.callback(() => {
				stream.error(new Error('test'));
				assert.isFalse(stream._allowPull);
			}));
		},

		'queue full'() {
			var dfd = this.async(asyncTimeout);
			var stream = new ReadableStream(new BaseStringSource());
			stream.started.then(dfd.callback(() => {
				stream.enqueue('test 1');
				assert.equal(0, stream.desiredSize);
				assert.isFalse(stream._allowPull);
			}));
		},

		'pull requested'() {
			var dfd = this.async(asyncTimeout);
			var source = new BaseStringSource();
			source.pull = (controller: ReadableStreamController<string>): Promise<void> => {
				return new Promise<void>(() => { /* never resolves */});
			};
			var stream = new ReadableStream(source);
			stream.started.then(dfd.callback(() => {
				stream._pull();
				assert.isTrue(stream._pullScheduled);
				assert.isFalse(stream._allowPull);
			}));
		}
	},

	'tee': {
		'not readable'() {
			var stream = new ReadableStream(new BaseStringSource());
			stream._underlyingSource = undefined;
			assert.throws(() => { stream.tee() });

			stream = new ReadableStream(new BaseStringSource());
			stream._close();
			assert.throws(() => { stream.tee() });
		},

		'two streams'() {
			var stream = new ReadableStream(new BaseStringSource());
			var tees = stream.tee();
			assert.equal(2, tees.length);
			assert.isObject(tees[0]);
			assert.isObject(tees[1]);
		},

		'cancel'() {
			var dfd = this.async(asyncTimeout);
			var stream = new ReadableStream(new BaseStringSource());
			var [stream1, stream2] = stream.tee();
			stream1.cancel('because').then(dfd.callback(() => {
				assert.equal(State.Closed, stream1.state);
				assert.equal(State.Closed, stream2.state);
				assert.equal(State.Closed, stream.state);
			}), dfd.rejectOnError((error: any) => { assert.fail(error); }));
			stream2.cancel('testing').then(dfd.rejectOnError(() => { }),
				dfd.rejectOnError((error: any) => { assert.fail(error); }));
		},

		'pull'() {
			var dfd = this.async(asyncTimeout);
			var i = 1;
			var source = new BaseStringSource();
			source.pull = (controller: ReadableStreamController<string>): Promise<void> => {
				controller.enqueue('test ' + i++);
				return Promise.resolve();
			};
			var stream = new ReadableStream(source);
			var [stream1, stream2] = stream.tee();

			Promise.all([stream1.getReader().read(), stream2.getReader().read()]).then(
				dfd.callback((value: ReadResult<string>[]) => {
					assert.equal('test 1', value[0].value);
					assert.equal('test 1', value[1].value);
				})
			);
		}
	}
});

