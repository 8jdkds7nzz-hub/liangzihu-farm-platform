export interface Notice {
    id: string;
    requestKey: string;
    recipientId: string;
    alertId: string;
    text: string;
}
export interface Receipt {
    state: 'accepted' | 'delivered' | 'failed' | 'unknown';
    providerRequestId: string | null;
    occurredAt: string;
    reason: string | null;
    connected?: boolean | null;
}
export interface NotificationProvider {
    send(notice: Notice): Promise<Receipt>;
    query(providerRequestId: string): Promise<Receipt>;
}
