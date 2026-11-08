export type Member = { id: string; name: string };
export type Share = { memberId: string; amountCents: number };

export type Expense = {
    id: string;
    title: string;
    category: string;
    amountCents: number;
    paidById: string;
    date: string; // YYYY-MM-DD
    splitMode: 'equal' | 'custom';
    shares: Share[];
};

export type Repayment = {
    id: string;
    fromId: string;
    toId: string;
    amountCents: number;
    date: string;
};

export type Household = {
    id: string;
    name: string;
    currency: 'LKR';
    members: Member[];
    expenses: Expense[];
    repayments: Repayment[];
    updatedAt: string;
};

export type Backup = {
    app: 'RoomSplit';
    schemaVersion: 1;
    exportedAt: string;
    household: Household;
};