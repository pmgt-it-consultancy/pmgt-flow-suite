"use client";

import { pdf } from "@react-pdf/renderer";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ReportPdfDocument, type ReportPdfDocumentProps } from "./ReportPdfDocument";

interface DownloadPdfButtonProps {
  data: ReportPdfDocumentProps;
  reportDate: string;
  storeName: string;
  disabled?: boolean;
}

export const DownloadPdfButton = ({
  data,
  reportDate,
  storeName,
  disabled,
}: DownloadPdfButtonProps) => {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleDownload = async () => {
    setIsGenerating(true);
    try {
      const blob = await pdf(<ReportPdfDocument {...data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${storeName.replace(/\s+/g, "-")}-daily-report-${reportDate}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded successfully");
    } catch (error) {
      toast.error("Failed to generate PDF");
      console.error("PDF generation error:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={disabled || isGenerating}
    >
      {isGenerating ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}
      {isGenerating ? "Generating..." : "Download PDF"}
    </Button>
  );
};
