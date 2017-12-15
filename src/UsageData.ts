import TelemetryReporter from "vscode-extension-telemetry";

export module UsageData {
    const extensionId: string = "eskibear.vscode-maven";
    const reporter: TelemetryReporter = new TelemetryReporter("eskibear.vscode-maven", "9.9.9", "key");
    export function startTransaction(): Transaction {
        const trans: Transaction = new Transaction();
        trans.id = null;
        trans.startAt = new Date();
        return trans;
    }
    export function terminateTransection(transection: Transaction): void {
        transection.stopAt = new Date();
    }

    export function report(eventType: EventType, event: ICustomEvent): void {
        reporter.sendTelemetryEvent(`${extensionId}/${eventType}`, event.properties, event.measures);
    }

    export function reportTransaction(transaction: Transaction): void {
        const event: ICustomEvent = transaction.getCustomEvent();
        report(EventType.Transection, event);

    }

    export class Transaction {
        public id: string;
        public name: string;
        public startAt?: Date;
        public stopAt?: Date;
        public success?: boolean;

        private customMeasures?: { [key: string]: ICustomMeasure } = {};
        private customProperties?: { [key: string]: {} } = {};

        public getCustomEvent(): ICustomEvent {
            const ret: ICustomEvent = {};
            ret.measures = Object.assign(
                {},
                ...Object.keys(this.customMeasures).map((k: string) => ({ [k]: this.customMeasures[k].reduceFunc(this.customMeasures[k].observes) })),
                { duration: this.stopAt.getTime() - this.startAt.getTime() }
            );
            ret.properties = Object.assign({}, this.customProperties, { startAt: this.startAt, stopAt: this.stopAt, success: this.success });
            return ret;
        }

        public initMeasure<T>(key: string, reduceFunc: (observes: T[]) => number): void {
            if (!this.customMeasures[key]) {
                this.customMeasures[key] = { observes: [], reduceFunc };
            }
        }

        public observeMeasure<T>(key: string, observe: T): void {
            if (this.customMeasures[key]) {
                this.customMeasures[key].observes.push(observe);
            }
        }

        public stop(): void {
            this.stopAt = new Date();
        }
    }
    interface ICustomMeasure {
        observes: {}[];
        reduceFunc(observes: {}[]): number;
    }
    enum EventType {
        Error = "Error",
        Transection = "Transection",
        Event = "Event"
    }
}

interface ICustomEvent {
    properties?: {};
    measures?: {};
}
