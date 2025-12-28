
import React, { useState, useCallback, useRef } from 'react';
import { 
  Upload, 
  Trash2, 
  Settings as SettingsIcon, 
  Play, 
  Download, 
  CheckCircle, 
  Loader2,
  FileArchive,
  Grid,
  Image as ImageIcon
} from 'lucide-react';
import JSZip from 'jszip';
import { GridJob, AppSettings, ProcessedSlice } from './types';
import { fileToBase64, splitImage } from './utils/imageUtils';
import { enhanceAndCleanImage } from './services/geminiService';

export default function App() {
  const [jobs, setJobs] = useState<GridJob[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    rows: 3,
    cols: 3,
    enhanceQuality: true,
    removeText: true,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newJobs: GridJob[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const base64 = await fileToBase64(file);
      
      // Initial split to preview
      const sliceUrls = await splitImage(base64, settings.rows, settings.cols);
      
      newJobs.push({
        id: Math.random().toString(36).substring(7),
        fileName: file.name,
        originalImage: base64,
        rows: settings.rows,
        cols: settings.cols,
        slices: sliceUrls.map((url, idx) => ({
          id: `${idx}`,
          originalSlice: url,
          enhancedSlice: null,
          status: 'pending',
        })),
      });
    }

    setJobs(prev => [...prev, ...newJobs]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeJob = (id: string) => {
    setJobs(prev => prev.filter(j => j.id !== id));
  };

  const processAll = async () => {
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      for (let jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
        const job = jobs[jobIndex];
        
        for (let sliceIndex = 0; sliceIndex < job.slices.length; sliceIndex++) {
          const slice = job.slices[sliceIndex];
          
          if (slice.status === 'completed') continue;

          // Update status to processing
          setJobs(prev => {
            const next = [...prev];
            next[jobIndex].slices[sliceIndex].status = 'processing';
            return next;
          });

          try {
            const result = await enhanceAndCleanImage(slice.originalSlice);
            
            setJobs(prev => {
              const next = [...prev];
              next[jobIndex].slices[sliceIndex].enhancedSlice = result;
              next[jobIndex].slices[sliceIndex].status = 'completed';
              return next;
            });
          } catch (error) {
            console.error(error);
            setJobs(prev => {
              const next = [...prev];
              next[jobIndex].slices[sliceIndex].status = 'error';
              next[jobIndex].slices[sliceIndex].error = 'AI Processing failed';
              return next;
            });
          }
        }
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadAllAsZip = async () => {
    const zip = new JSZip();
    
    jobs.forEach(job => {
      const folder = zip.folder(job.fileName.split('.')[0]);
      job.slices.forEach((slice, idx) => {
        const data = slice.enhancedSlice || slice.originalSlice;
        const base64Data = data.split(',')[1];
        folder?.file(`slice_${idx + 1}.png`, base64Data, { base64: true });
      });
    });

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = `enhanced_grids_${new Date().getTime()}.zip`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadJobSlices = async (job: GridJob) => {
    const zip = new JSZip();
    const folderName = job.fileName.split('.')[0];
    job.slices.forEach((slice, idx) => {
      const data = slice.enhancedSlice || slice.originalSlice;
      const base64Data = data.split(',')[1];
      zip.file(`${folderName}_${idx + 1}.png`, base64Data, { base64: true });
    });

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${folderName}_slices.zip`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen pb-20 px-4 md:px-8">
      {/* Header */}
      <header className="py-8 max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
        <div>
          <h1 className="text-4xl font-bold gradient-text">AI九宫格拆解 & 增强</h1>
          <p className="text-slate-500 mt-2 font-medium">批量处理拼图，AI自动去字、超分增强</p>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={processAll}
            disabled={jobs.length === 0 || isProcessing}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white px-6 py-3 rounded-full font-semibold transition-all shadow-lg hover:shadow-indigo-200"
          >
            {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
            开始批量处理
          </button>
          
          <button 
            onClick={downloadAllAsZip}
            disabled={jobs.length === 0 || isProcessing}
            className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-6 py-3 rounded-full font-semibold transition-all shadow-sm"
          >
            <FileArchive className="w-5 h-5" />
            打包下载全部
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto space-y-8">
        {/* Settings Panel */}
        <div className="glass rounded-3xl p-6 shadow-sm border border-slate-200">
          <div className="flex flex-wrap items-center gap-8">
            <div className="flex items-center gap-3">
              <Grid className="w-5 h-5 text-indigo-500" />
              <span className="text-sm font-semibold text-slate-700">分割布局:</span>
              <select 
                value={settings.rows}
                onChange={(e) => setSettings({...settings, rows: parseInt(e.target.value), cols: parseInt(e.target.value)})}
                className="bg-slate-100 border-none rounded-lg px-3 py-1.5 text-sm focus:ring-2 ring-indigo-500 outline-none"
              >
                <option value={2}>2x2 (4格)</option>
                <option value={3}>3x3 (9格)</option>
                <option value={4}>4x4 (16格)</option>
              </select>
            </div>
            
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className="relative">
                <input 
                  type="checkbox" 
                  checked={settings.enhanceQuality}
                  onChange={(e) => setSettings({...settings, enhanceQuality: e.target.checked})}
                  className="sr-only" 
                />
                <div className={`w-10 h-6 rounded-full transition-colors ${settings.enhanceQuality ? 'bg-indigo-600' : 'bg-slate-200'}`}></div>
                <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${settings.enhanceQuality ? 'translate-x-4' : ''}`}></div>
              </div>
              <span className="text-sm text-slate-600 font-medium group-hover:text-indigo-600 transition-colors">AI超分增强</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer group">
              <div className="relative">
                <input 
                  type="checkbox" 
                  checked={settings.removeText}
                  onChange={(e) => setSettings({...settings, removeText: e.target.checked})}
                  className="sr-only" 
                />
                <div className={`w-10 h-6 rounded-full transition-colors ${settings.removeText ? 'bg-indigo-600' : 'bg-slate-200'}`}></div>
                <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${settings.removeText ? 'translate-x-4' : ''}`}></div>
              </div>
              <span className="text-sm text-slate-600 font-medium group-hover:text-indigo-600 transition-colors">AI去水印/文字</span>
            </label>
          </div>
        </div>

        {/* Upload Zone */}
        <div 
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-300 hover:border-indigo-400 bg-white/50 hover:bg-indigo-50/30 rounded-3xl p-12 text-center cursor-pointer transition-all group"
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            multiple 
            accept="image/*" 
            className="hidden" 
          />
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Upload className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-800">点击或拖拽上传拼图</h3>
            <p className="text-slate-500 mt-1">支持批量上传，支持常见的图片格式</p>
          </div>
        </div>

        {/* Jobs List */}
        <div className="space-y-6">
          {jobs.map((job) => (
            <div key={job.id} className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-5 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200">
                    <img src={job.originalImage} className="w-full h-full object-cover" alt="Original" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 truncate max-w-xs">{job.fileName}</h4>
                    <p className="text-xs text-slate-500">{job.rows}x{job.cols} 分割 • {job.slices.length} 个切片</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => downloadJobSlices(job)}
                    className="p-2 text-slate-600 hover:text-indigo-600 hover:bg-white rounded-xl transition-all"
                  >
                    <Download className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => removeJob(job.id)}
                    className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {job.slices.map((slice) => (
                  <div key={slice.id} className="relative group aspect-square">
                    <div className="w-full h-full rounded-2xl overflow-hidden bg-slate-100 border border-slate-200">
                      <img 
                        src={slice.enhancedSlice || slice.originalSlice} 
                        className="w-full h-full object-cover transition-opacity" 
                        alt={`Slice ${slice.id}`}
                      />
                    </div>
                    
                    {/* Status Overlays */}
                    {slice.status === 'processing' && (
                      <div className="absolute inset-0 bg-white/70 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-2xl">
                        <Loader2 className="w-6 h-6 text-indigo-600 animate-spin mb-1" />
                        <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-tighter">增强中...</span>
                      </div>
                    )}

                    {slice.status === 'completed' && (
                      <div className="absolute top-2 right-2 bg-green-500 text-white p-1 rounded-full shadow-lg">
                        <CheckCircle className="w-3 h-3" />
                      </div>
                    )}

                    {slice.status === 'error' && (
                      <div className="absolute inset-0 bg-rose-50/90 flex items-center justify-center rounded-2xl p-2 text-center">
                        <span className="text-[10px] text-rose-600 font-bold uppercase">{slice.error}</span>
                      </div>
                    )}

                    {/* Quick Download Hover */}
                    {slice.status === 'completed' && (
                      <a 
                        href={slice.enhancedSlice!} 
                        download={`slice_${job.fileName}_${slice.id}.png`}
                        className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-2xl transition-opacity"
                      >
                        <Download className="text-white w-6 h-6" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {jobs.length === 0 && (
            <div className="text-center py-20 bg-slate-50/50 rounded-3xl border-2 border-dotted border-slate-200">
              <div className="text-slate-300 flex flex-col items-center">
                <ImageIcon className="w-12 h-12 mb-4" />
                <p>暂无待处理任务，请上传图片</p>
              </div>
            </div>
          )}
        </div>
      </main>
      
      {/* Persistent Footer Stats */}
      {jobs.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 glass px-8 py-4 rounded-full shadow-2xl border border-white/50 flex items-center gap-8 z-50">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-bold uppercase">任务总数</span>
            <span className="text-lg font-bold text-slate-800">{jobs.length} 张图片</span>
          </div>
          <div className="h-8 w-px bg-slate-200"></div>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-bold uppercase">切片进度</span>
            <span className="text-lg font-bold text-indigo-600">
              {jobs.reduce((acc, job) => acc + job.slices.filter(s => s.status === 'completed').length, 0)} 
              <span className="text-slate-300 text-sm mx-1">/</span>
              {jobs.reduce((acc, job) => acc + job.slices.length, 0)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
