import PointHistory from './point-history';
export default async function PointPage({ params }: {
    params: Promise<{
        id: string;
    }>;
}) { const { id } = await params; return <PointHistory id={id}/>; }
