interface Env {
    DB: any;
}

export const onRequest: PagesFunction<Env> = async (context) => {
    try {
        let query = `SELECT * FROM platforms ORDER BY brand ASC, launch_date ASC`;
        const stmt = context.env.DB.prepare(query);
        const { results } = await stmt.all();
        return Response.json(results);
    } catch (e) {
        return Response.json({ error: e.message }, { status: 500 });
    }
};
