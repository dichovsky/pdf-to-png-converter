export interface OutputSink {
    write(name: string, content: Buffer): Promise<string>;
}
