
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

export const splitImage = async (
  base64Image: string,
  rows: number,
  cols: number
): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = base64Image;
    img.onload = () => {
      const sliceWidth = Math.floor(img.width / cols);
      const sliceHeight = Math.floor(img.height / rows);
      const slices: string[] = [];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const canvas = document.createElement('canvas');
          canvas.width = sliceWidth;
          canvas.height = sliceHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          ctx.drawImage(
            img,
            c * sliceWidth,
            r * sliceHeight,
            sliceWidth,
            sliceHeight,
            0,
            0,
            sliceWidth,
            sliceHeight
          );
          slices.push(canvas.toDataURL('image/png'));
        }
      }
      resolve(slices);
    };
    img.onerror = (err) => reject(err);
  });
};
