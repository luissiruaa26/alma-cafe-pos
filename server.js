const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'cafeteria.db');

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Conexión a la base de datos física SQLite (RNF-08)
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error('Error abriendo cafeteria.db:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite:', DB_FILE);
    }
});

// Creación de tablas relacionales y almacenamiento de estado transaccional
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id_usuario INTEGER PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        nombre TEXT NOT NULL,
        rol TEXT NOT NULL,
        activo INTEGER NOT NULL DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS productos (
        id_producto INTEGER PRIMARY KEY,
        codigo TEXT UNIQUE NOT NULL,
        nombre TEXT NOT NULL,
        categoria TEXT NOT NULL,
        descripcion TEXT,
        precio REAL NOT NULL CHECK(precio > 0),
        existencia INTEGER NOT NULL CHECK(existencia >= 0),
        activo INTEGER NOT NULL DEFAULT 1,
        imagen TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS pedidos (
        id_pedido INTEGER PRIMARY KEY,
        numero_pedido TEXT UNIQUE NOT NULL,
        fecha_hora TEXT NOT NULL,
        estado TEXT NOT NULL,
        total REAL NOT NULL,
        motivo_cancelacion TEXT,
        id_usuario INTEGER NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS instantanea_bd (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        contenido_json TEXT NOT NULL,
        actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Endpoint para leer la base de datos al abrir o recargar la página
app.get('/api/state', (req, res) => {
    db.get(`SELECT contenido_json FROM instantanea_bd WHERE id = 1`, [], (err, row) => {
        if (err) {
            return res.status(500).json({ ok: false, mensaje: 'Error interno al leer la base de datos.' });
        }
        if (!row) {
            return res.json({ ok: true, BD: null });
        }
        return res.json({ ok: true, BD: JSON.parse(row.contenido_json) });
    });
});

// Endpoint transaccional para sincronizar cambios de pedidos, stock y usuarios en cafeteria.db
app.post('/api/sync', (req, res) => {
    const { BD } = req.body;
    if (!BD) {
        return res.status(400).json({ ok: false, mensaje: 'Datos incompletos.' });
    }

    const jsonPayload = JSON.stringify(BD);

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        db.run(
            `INSERT INTO instantanea_bd (id, contenido_json, actualizado_en)
            VALUES (1, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET contenido_json = excluded.contenido_json, actualizado_en = CURRENT_TIMESTAMP`,
            [jsonPayload]
        );

        // Sincronizar tabla relacional de productos para consultas SQL directas
        if (Array.isArray(BD.productos)) {
            const stmtProd = db.prepare(
                `INSERT OR REPLACE INTO productos (id_producto, codigo, nombre, categoria, descripcion, precio, existencia, activo, imagen)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            BD.productos.forEach(p => {
                stmtProd.run([p.id_producto, p.codigo, p.nombre, p.categoria, p.descripcion, p.precio, p.existencia, p.activo ? 1 : 0, p.imagen]);
            });
            stmtProd.finalize();
        }

        // Sincronizar tabla relacional de usuarios (con password_hash SHA-256)
        if (Array.isArray(BD.usuarios)) {
            const stmtUser = db.prepare(
                `INSERT OR REPLACE INTO usuarios (id_usuario, username, password_hash, nombre, rol, activo)
                VALUES (?, ?, ?, ?, ?, ?)`
            );
            BD.usuarios.forEach(u => {
                stmtUser.run([u.id_usuario, u.username, u.password_hash, u.nombre, u.rol, u.activo ? 1 : 0]);
            });
            stmtUser.finalize();
        }

        // Sincronizar tabla relacional de pedidos
        if (Array.isArray(BD.pedidos)) {
            const stmtPed = db.prepare(
                `INSERT OR REPLACE INTO pedidos (id_pedido, numero_pedido, fecha_hora, estado, total, motivo_cancelacion, id_usuario)
                VALUES (?, ?, ?, ?, ?, ?, ?)`
            );
            BD.pedidos.forEach(ped => {
                stmtPed.run([ped.id_pedido, ped.numero_pedido, ped.fecha_hora, ped.estado, ped.total, ped.motivo_cancelacion, ped.id_usuario]);
            });
            stmtPed.finalize();
        }

        db.run('COMMIT', (err) => {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ ok: false, mensaje: 'Error guardando transacción en SQLite.' });
            }
            return res.json({ ok: true, mensaje: 'Sincronizado en cafeteria.db' });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Servidor Alma Café activo en http://localhost:${PORT}`);
});