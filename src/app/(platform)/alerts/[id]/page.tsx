import AlertDetail from './alert-detail';
export default async function AlertPage({ params }: {
    params: Promise<{
        id: string;
    }>;
}) { const { id } = await params; return <AlertDetail id={id}/>; }
