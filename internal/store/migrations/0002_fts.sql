CREATE VIRTUAL TABLE section_fts USING fts5(
  title,
  body,
  content='sections',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER sections_ai AFTER INSERT ON sections BEGIN
  INSERT INTO section_fts(rowid, title, body)
    VALUES (new.rowid, new.title, new.body);
END;

CREATE TRIGGER sections_ad AFTER DELETE ON sections BEGIN
  INSERT INTO section_fts(section_fts, rowid, title, body)
    VALUES('delete', old.rowid, old.title, old.body);
END;

CREATE TRIGGER sections_au AFTER UPDATE ON sections BEGIN
  INSERT INTO section_fts(section_fts, rowid, title, body)
    VALUES('delete', old.rowid, old.title, old.body);
  INSERT INTO section_fts(rowid, title, body)
    VALUES (new.rowid, new.title, new.body);
END;
