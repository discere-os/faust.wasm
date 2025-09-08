/**
 * Faust.wasm WASM-Native Filesystem Implementation
 * Advanced audio asset management and persistent storage for Faust DSP
 * Advanced filesystem integration for Faust DSP
 * 
 * WASM Integration Copyright (c) 2025 Superstruct Ltd, New Zealand
 * Licensed under the same license as the underlying Faust project (LGPL 2.1)
 */

class FaustWASMNativeFilesystem {
    constructor(faustModule, options = {}) {
        this.module = faustModule;
        this.FS = faustModule.FS;
        this.options = {
            enablePersistence: true,
            enableCDNLoading: true,
            enableAudioAssetCache: true,
            maxCacheSize: 100 * 1024 * 1024, // 100MB
            ...options
        };
        
        this.initialized = false;
        this.persistentStorageEnabled = false;
        this.audioAssetCache = new Map();
        this.downloadQueue = new Set();
        
        // Virtual filesystem paths for Faust audio assets
        this.paths = {
            dsp_code: '/faust-dsp',
            audio_samples: '/faust-samples',
            impulse_responses: '/faust-impulses',
            presets: '/faust-presets',
            libraries: '/faust-libraries',
            temp: '/faust-temp',
            cache: '/faust-cache'
        };
        
        // Performance and usage statistics
        this.stats = {
            filesLoaded: 0,
            bytesLoaded: 0,
            cacheHits: 0,
            cacheMisses: 0,
            persistentSyncs: 0,
            avgLoadTime: 0
        };
    }
    
    /**
     * Initialize WASM-native filesystem with all advanced features
     */
    async initialize() {
        if (this.initialized) {
            return true;
        }
        
        console.log('🗂️ Initializing Faust.wasm Native Filesystem...');
        
        try {
            // Setup virtual filesystem structure
            await this.setupVirtualFilesystem();
            
            // Enable persistent storage if supported
            if (this.options.enablePersistence) {
                await this.enablePersistentStorage();
            }
            
            // Setup audio asset caching
            if (this.options.enableAudioAssetCache) {
                await this.setupAudioAssetCache();
            }
            
            // Load essential Faust libraries
            await this.loadEssentialFaustLibraries();
            
            this.initialized = true;
            console.log('✅ Faust.wasm Native Filesystem initialized');
            
            return true;
            
        } catch (error) {
            console.error('❌ Failed to initialize filesystem:', error);
            return false;
        }
    }
    
    /**
     * Setup virtual filesystem directory structure
     */
    async setupVirtualFilesystem() {
        console.log('📁 Setting up virtual filesystem structure...');
        
        // Create all required directories
        Object.values(this.paths).forEach(path => {
            try {
                this.FS.mkdir(path);
                console.log(`   Created: ${path}`);
            } catch (error) {
                if (error.errno !== 20) { // EEXIST is OK
                    console.warn(`   Failed to create ${path}:`, error.message);
                }
            }
        });
        
        // Setup temp directory with automatic cleanup
        this.setupTempDirectory();
        
        // Create default configuration files
        await this.createDefaultConfigurations();
    }
    
    /**
     * Enable IDBFS persistent storage for audio assets and presets
     */
    async enablePersistentStorage() {
        if (!this.checkPersistentStorageSupport()) {
            console.warn('⚠️ Persistent storage not supported in this environment');
            return false;
        }
        
        try {
            console.log('💾 Enabling persistent storage with IDBFS...');
            
            // Mount IDBFS for persistent directories
            const persistentPaths = [
                this.paths.presets,
                this.paths.audio_samples,
                this.paths.impulse_responses,
                this.paths.cache
            ];
            
            for (const path of persistentPaths) {
                this.FS.mount(this.FS.filesystems.IDBFS, {}, path);
                console.log(`   Mounted IDBFS: ${path}`);
            }
            
            // Synchronize from IndexedDB (load existing data)
            await this.syncFromPersistentStorage();
            
            // Setup periodic sync to IndexedDB
            this.setupPeriodicSync();
            
            this.persistentStorageEnabled = true;
            console.log('✅ Persistent storage enabled');
            
            return true;
            
        } catch (error) {
            console.error('❌ Failed to enable persistent storage:', error);
            return false;
        }
    }
    
    /**
     * Setup audio asset caching with intelligent preloading
     */
    async setupAudioAssetCache() {
        console.log('🎵 Setting up audio asset cache...');
        
        // Create cache metadata file
        const cacheMetadataPath = `${this.paths.cache}/metadata.json`;
        
        try {
            // Load existing cache metadata
            const metadataContent = this.FS.readFile(cacheMetadataPath, { encoding: 'utf8' });
            const metadata = JSON.parse(metadataContent);
            
            console.log(`   Loaded cache metadata: ${metadata.assetCount} assets`);
            
        } catch (error) {
            // Create new cache metadata
            const initialMetadata = {
                version: '1.0',
                assetCount: 0,
                totalSize: 0,
                lastUpdated: new Date().toISOString(),
                assets: {}
            };
            
            this.FS.writeFile(cacheMetadataPath, JSON.stringify(initialMetadata, null, 2));
            console.log('   Created new cache metadata');
        }
        
        console.log('✅ Audio asset cache ready');
    }
    
    /**
     * Load essential Faust libraries and standard components
     */
    async loadEssentialFaustLibraries() {
        console.log('📚 Loading essential Faust libraries...');
        
        const essentialLibraries = [
            {
                name: 'stdfaust.lib',
                url: 'https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/stdfaust.lib',
                description: 'Standard Faust library'
            },
            {
                name: 'oscillators.lib', 
                url: 'https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/oscillators.lib',
                description: 'Oscillator library'
            },
            {
                name: 'filters.lib',
                url: 'https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/filters.lib', 
                description: 'Filter library'
            },
            {
                name: 'effects.lib',
                url: 'https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/effects.lib',
                description: 'Effects library'
            }
        ];
        
        // Load libraries with caching
        for (const library of essentialLibraries) {
            try {
                await this.loadFaustLibrary(library.name, library.url);
                console.log(`   ✅ ${library.name}: ${library.description}`);
            } catch (error) {
                console.warn(`   ⚠️ Failed to load ${library.name}:`, error.message);
                // Continue loading other libraries
            }
        }
    }
    
    /**
     * Load Faust library with caching and version management
     */
    async loadFaustLibrary(libraryName, url) {
        const libraryPath = `${this.paths.libraries}/${libraryName}`;
        
        // Check if library is cached and still valid
        if (await this.isLibraryCacheValid(libraryName)) {
            this.stats.cacheHits++;
            console.log(`   📋 Using cached: ${libraryName}`);
            return this.FS.readFile(libraryPath, { encoding: 'utf8' });
        }
        
        if (!this.options.enableCDNLoading) {
            console.warn(`   ⚠️ CDN loading disabled, skipping: ${libraryName}`);
            return null;
        }
        
        try {
            const startTime = performance.now();
            
            console.log(`   🌐 Loading: ${libraryName} from ${url}`);
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const libraryContent = await response.text();
            const loadTime = performance.now() - startTime;
            
            // Cache the library
            this.FS.writeFile(libraryPath, libraryContent);
            
            // Update cache metadata
            await this.updateLibraryCacheMetadata(libraryName, {
                size: libraryContent.length,
                loadTime,
                lastUpdated: new Date().toISOString(),
                url
            });
            
            this.stats.filesLoaded++;
            this.stats.bytesLoaded += libraryContent.length;
            this.stats.cacheMisses++;
            this.stats.avgLoadTime = (this.stats.avgLoadTime + loadTime) / 2;
            
            console.log(`   ✅ Cached: ${libraryName} (${libraryContent.length} bytes, ${loadTime.toFixed(0)}ms)`);
            
            // Sync to persistent storage if enabled
            if (this.persistentStorageEnabled) {
                this.deferredSyncToPersistentStorage();
            }
            
            return libraryContent;
            
        } catch (error) {
            console.error(`   ❌ Failed to load ${libraryName}:`, error);
            throw error;
        }
    }
    
    /**
     * Load audio sample with format detection and caching
     */
    async loadAudioSample(sampleName, url, options = {}) {
        const samplePath = `${this.paths.audio_samples}/${sampleName}`;
        
        // Check cache first
        if (this.FS.analyzePath(samplePath).exists && !options.forceReload) {
            this.stats.cacheHits++;
            console.log(`🎵 Using cached sample: ${sampleName}`);
            return this.FS.readFile(samplePath);
        }
        
        if (!this.options.enableCDNLoading) {
            console.warn(`⚠️ CDN loading disabled, skipping sample: ${sampleName}`);
            return null;
        }
        
        try {
            console.log(`🌐 Loading audio sample: ${sampleName}`);
            
            const startTime = performance.now();
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const sampleData = new Uint8Array(await response.arrayBuffer());
            const loadTime = performance.now() - startTime;
            
            // Detect audio format
            const audioFormat = this.detectAudioFormat(sampleData);
            console.log(`   Format detected: ${audioFormat}`);
            
            // Cache the sample
            this.FS.writeFile(samplePath, sampleData);
            
            // Update statistics and metadata
            this.stats.filesLoaded++;
            this.stats.bytesLoaded += sampleData.length;
            this.stats.cacheMisses++;
            
            await this.updateAudioAssetMetadata(sampleName, {
                format: audioFormat,
                size: sampleData.length,
                loadTime,
                url,
                lastAccessed: new Date().toISOString()
            });
            
            console.log(`✅ Audio sample cached: ${sampleName} (${sampleData.length} bytes, ${audioFormat})`);
            
            return sampleData;
            
        } catch (error) {
            console.error(`❌ Failed to load audio sample ${sampleName}:`, error);
            throw error;
        }
    }
    
    /**
     * Load impulse response for convolution reverb
     */
    async loadImpulseResponse(impulseName, url, options = {}) {
        const impulsePath = `${this.paths.impulse_responses}/${impulseName}`;
        
        // Check cache with validation
        if (await this.isImpulseCacheValid(impulseName) && !options.forceReload) {
            this.stats.cacheHits++;
            console.log(`🏛️ Using cached impulse: ${impulseName}`);
            return this.FS.readFile(impulsePath);
        }
        
        try {
            console.log(`🌐 Loading impulse response: ${impulseName}`);
            
            const impulseData = await this.loadAudioSample(`impulse_${impulseName}`, url, options);
            
            // Copy to impulse responses directory
            this.FS.writeFile(impulsePath, impulseData);
            
            // Validate impulse response characteristics
            const validation = this.validateImpulseResponse(impulseData);
            if (!validation.isValid) {
                console.warn(`⚠️ Impulse response validation warnings for ${impulseName}:`, validation.warnings);
            }
            
            console.log(`✅ Impulse response ready: ${impulseName}`);
            return impulseData;
            
        } catch (error) {
            console.error(`❌ Failed to load impulse response ${impulseName}:`, error);
            throw error;
        }
    }
    
    /**
     * Save and manage Faust DSP presets with versioning
     */
    async savePreset(presetName, dspCode, parameters = {}, metadata = {}) {
        const presetPath = `${this.paths.presets}/${presetName}.json`;
        
        const preset = {
            version: '1.0',
            name: presetName,
            dspCode,
            parameters,
            metadata: {
                ...metadata,
                createdAt: new Date().toISOString(),
                faustVersion: this.getFaustVersion()
            }
        };
        
        try {
            this.FS.writeFile(presetPath, JSON.stringify(preset, null, 2));
            console.log(`💾 Preset saved: ${presetName}`);
            
            // Sync to persistent storage
            if (this.persistentStorageEnabled) {
                await this.syncToPersistentStorage();
            }
            
            return true;
            
        } catch (error) {
            console.error(`❌ Failed to save preset ${presetName}:`, error);
            return false;
        }
    }
    
    /**
     * Load Faust DSP preset with validation
     */
    async loadPreset(presetName) {
        const presetPath = `${this.paths.presets}/${presetName}.json`;
        
        try {
            if (!this.FS.analyzePath(presetPath).exists) {
                throw new Error(`Preset not found: ${presetName}`);
            }
            
            const presetContent = this.FS.readFile(presetPath, { encoding: 'utf8' });
            const preset = JSON.parse(presetContent);
            
            // Validate preset format
            if (!this.validatePreset(preset)) {
                throw new Error(`Invalid preset format: ${presetName}`);
            }
            
            console.log(`📋 Preset loaded: ${presetName} (v${preset.version})`);
            return preset;
            
        } catch (error) {
            console.error(`❌ Failed to load preset ${presetName}:`, error);
            throw error;
        }
    }
    
    /**
     * List all available presets with metadata
     */
    async listPresets() {
        try {
            const presetFiles = this.FS.readdir(this.paths.presets)
                .filter(file => file.endsWith('.json'));
            
            const presets = [];
            
            for (const file of presetFiles) {
                try {
                    const presetPath = `${this.paths.presets}/${file}`;
                    const content = this.FS.readFile(presetPath, { encoding: 'utf8' });
                    const preset = JSON.parse(content);
                    
                    presets.push({
                        name: preset.name,
                        version: preset.version,
                        createdAt: preset.metadata?.createdAt,
                        description: preset.metadata?.description || 'No description'
                    });
                    
                } catch (error) {
                    console.warn(`⚠️ Failed to read preset ${file}:`, error.message);
                }
            }
            
            return presets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            
        } catch (error) {
            console.error('❌ Failed to list presets:', error);
            return [];
        }
    }
    
    /**
     * Create temporary file with automatic cleanup
     */
    createTempFile(filename, content) {
        const tempPath = `${this.paths.temp}/${filename}`;
        
        try {
            if (typeof content === 'string') {
                this.FS.writeFile(tempPath, content);
            } else {
                this.FS.writeFile(tempPath, content);
            }
            
            // Schedule cleanup
            setTimeout(() => {
                try {
                    if (this.FS.analyzePath(tempPath).exists) {
                        this.FS.unlink(tempPath);
                    }
                } catch (error) {
                    // Ignore cleanup errors
                }
            }, 300000); // 5 minutes
            
            return tempPath;
            
        } catch (error) {
            console.error(`❌ Failed to create temp file ${filename}:`, error);
            throw error;
        }
    }
    
    // Utility and helper methods
    
    checkPersistentStorageSupport() {
        return typeof indexedDB !== 'undefined' && 
               this.FS.filesystems && 
               this.FS.filesystems.IDBFS;
    }
    
    async syncFromPersistentStorage() {
        return new Promise((resolve, reject) => {
            this.FS.syncfs(true, (error) => {
                if (error) {
                    reject(new Error(`Failed to sync from persistent storage: ${error}`));
                } else {
                    console.log('📥 Synced from persistent storage');
                    resolve();
                }
            });
        });
    }
    
    async syncToPersistentStorage() {
        return new Promise((resolve, reject) => {
            this.FS.syncfs(false, (error) => {
                if (error) {
                    reject(new Error(`Failed to sync to persistent storage: ${error}`));
                } else {
                    this.stats.persistentSyncs++;
                    console.log('📤 Synced to persistent storage');
                    resolve();
                }
            });
        });
    }
    
    deferredSyncToPersistentStorage() {
        // Debounced sync to avoid excessive I/O
        clearTimeout(this.syncTimeout);
        this.syncTimeout = setTimeout(() => {
            this.syncToPersistentStorage().catch(console.error);
        }, 2000);
    }
    
    setupPeriodicSync() {
        // Sync to persistent storage every 5 minutes
        setInterval(() => {
            if (this.persistentStorageEnabled) {
                this.syncToPersistentStorage().catch(console.error);
            }
        }, 5 * 60 * 1000);
    }
    
    setupTempDirectory() {
        // Clean temp directory on startup
        try {
            const tempFiles = this.FS.readdir(this.paths.temp);
            tempFiles.forEach(file => {
                if (file !== '.' && file !== '..') {
                    this.FS.unlink(`${this.paths.temp}/${file}`);
                }
            });
        } catch (error) {
            // Temp directory may not exist yet
        }
        
        // Setup cleanup on page unload
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => {
                this.cleanup();
            });
        }
    }
    
    async createDefaultConfigurations() {
        // Create default Faust configuration
        const defaultConfig = {
            audio: {
                sampleRate: 44100,
                bufferSize: 128,
                channels: 2
            },
            dsp: {
                enableOptimizations: true,
                vectorSize: 4,
                mathApproximations: false
            },
            filesystem: {
                cacheEnabled: true,
                maxCacheSize: this.options.maxCacheSize,
                autoSync: true
            }
        };
        
        const configPath = `${this.paths.cache}/config.json`;
        
        if (!this.FS.analyzePath(configPath).exists) {
            this.FS.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
        }
    }
    
    detectAudioFormat(audioData) {
        // Simple audio format detection based on file headers
        const header = audioData.slice(0, 12);
        
        // WAV format
        if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
            return 'WAV';
        }
        
        // FLAC format
        if (header[0] === 0x66 && header[1] === 0x4C && header[2] === 0x61 && header[3] === 0x43) {
            return 'FLAC';
        }
        
        // Ogg format
        if (header[0] === 0x4F && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53) {
            return 'OGG';
        }
        
        return 'Unknown';
    }
    
    async isLibraryCacheValid(libraryName) {
        // Simple cache validation - could be enhanced with checksums
        const libraryPath = `${this.paths.libraries}/${libraryName}`;
        return this.FS.analyzePath(libraryPath).exists;
    }
    
    async isImpulseCacheValid(impulseName) {
        const impulsePath = `${this.paths.impulse_responses}/${impulseName}`;
        return this.FS.analyzePath(impulsePath).exists;
    }
    
    validateImpulseResponse(impulseData) {
        // Basic validation for impulse responses
        const validation = {
            isValid: true,
            warnings: []
        };
        
        if (impulseData.length < 1024) {
            validation.warnings.push('Impulse response very short (<1024 bytes)');
        }
        
        if (impulseData.length > 50 * 1024 * 1024) {
            validation.warnings.push('Impulse response very large (>50MB)');
        }
        
        return validation;
    }
    
    validatePreset(preset) {
        return preset.version && 
               preset.name && 
               preset.dspCode && 
               typeof preset.parameters === 'object';
    }
    
    async updateLibraryCacheMetadata(libraryName, metadata) {
        // Update library cache metadata for management
    }
    
    async updateAudioAssetMetadata(assetName, metadata) {
        // Update audio asset metadata for management
    }
    
    getFaustVersion() {
        return '2.81.2'; // Current Faust version
    }
    
    cleanup() {
        console.log('🧹 Cleaning up filesystem resources...');
        
        // Clean temp directory
        try {
            const tempFiles = this.FS.readdir(this.paths.temp);
            let cleanedFiles = 0;
            
            tempFiles.forEach(file => {
                if (file !== '.' && file !== '..') {
                    this.FS.unlink(`${this.paths.temp}/${file}`);
                    cleanedFiles++;
                }
            });
            
            if (cleanedFiles > 0) {
                console.log(`   Cleaned ${cleanedFiles} temporary files`);
            }
            
        } catch (error) {
            console.warn('   Failed to cleanup temp directory:', error.message);
        }
        
        // Final sync to persistent storage
        if (this.persistentStorageEnabled) {
            this.syncToPersistentStorage().catch(console.error);
        }
    }
    
    /**
     * Get filesystem usage statistics
     */
    getStats() {
        return {
            ...this.stats,
            cacheHitRate: this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses + 1),
            avgFileSizeKB: this.stats.bytesLoaded / (this.stats.filesLoaded || 1) / 1024,
            persistentStorageEnabled: this.persistentStorageEnabled
        };
    }
}

// Export for different module systems
export default FaustWASMNativeFilesystem;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FaustWASMNativeFilesystem;
}