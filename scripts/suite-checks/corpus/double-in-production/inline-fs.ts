function memoryFs(files) { return { read: async (path) => files[path] }; }
