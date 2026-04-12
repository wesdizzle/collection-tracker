interface Env {
  DB: any;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  try {
      const id = context.params.id;
      const query = `
          SELECT f.*, fs.line as series_line, fs.name as series_name, fs.sort_index as series_index
          FROM figures f
          LEFT JOIN figure_series fs ON f.series_id = fs.id
          WHERE f.id = ?
      `;
      const stmt = context.env.DB.prepare(query).bind(id);
      const figure = await stmt.first();
      
      if (!figure) return Response.json({ error: 'Not found' }, { status: 404 });
      return Response.json(figure);
  } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
  }
};
