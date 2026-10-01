import ObjectDetail from './object-detail';
export default async function ObjectPage({ params }: {
    params: Promise<{
        id: string;
    }>;
}) { const { id } = await params; return <ObjectDetail id={id}/>; }
