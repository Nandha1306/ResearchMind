import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Sparkles, AlertCircle, Upload } from "lucide-react";
import { workspaceDetailsSchema } from "../../lib/validations/workspace.schema";
import type { WorkspaceDetailsInput } from "../../lib/validations/workspace.schema";
import type { LocalOnboardingData } from "../../types/workspace.types";
import { Button } from "../ui/button";

interface WorkspaceDetailsStepProps {
  data: LocalOnboardingData;
  updateData: (updates: Partial<LocalOnboardingData>) => void;
  onNext: () => void;
}

export const WorkspaceDetailsStep: React.FC<WorkspaceDetailsStepProps> = ({
  data,
  updateData,
  onNext,
}) => {
  const [iconPreview, setIconPreview] = useState<string | null>(data.iconUrl || null);
  const [slugEdited, setSlugEdited] = useState(false);

  const slugify = (text: string) => {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/^-+|-+$/g, "");
  };

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<WorkspaceDetailsInput>({
    resolver: zodResolver(workspaceDetailsSchema),
    defaultValues: {
      name: data.name,
      urlSlug: data.urlSlug || "",
      description: data.description,
    },
  });

  const nameValue = watch("name");
  const descriptionValue = watch("description") || "";

  // Auto-generate URL slug when name changes, unless user edited slug manually
  useEffect(() => {
    if (nameValue && !slugEdited) {
      setValue("urlSlug", slugify(nameValue), { shouldValidate: true });
    }
  }, [nameValue, setValue, slugEdited]);

  const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Create mockup object URL for icon preview
      const previewUrl = URL.createObjectURL(file);
      setIconPreview(previewUrl);
      updateData({ iconUrl: previewUrl });
    }
  };

  const onSubmit = (formData: WorkspaceDetailsInput) => {
    updateData({
      name: formData.name,
      urlSlug: formData.urlSlug,
      description: formData.description,
    });
    onNext();
  };

  return (
    <div className="w-full max-w-[460px] space-y-6">
      {/* Page Title & Subtitle */}
      <div>
        <div className="flex items-center gap-1.5 bg-[rgba(124,106,247,0.08)] dark:bg-[rgba(124,106,247,0.12)] border border-primary text-primary text-[11px] rounded px-2 py-0.5 w-fit mb-3">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Step 1 of 4</span>
        </div>
        <h2 className="text-[22px] font-semibold text-foreground leading-tight mb-1">
          Name your workspace
        </h2>
        <p className="text-[13px] text-muted-foreground">
          This will be your team's shared knowledge base. You can always update these details later.
        </p>
      </div>

      {/* Form Details */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Workspace Icon Upload (UI Only) */}
        <div className="flex items-center gap-4 p-4 bg-card border border-border rounded-lg">
          <div className="relative w-14 h-14 rounded-full bg-secondary border border-border flex items-center justify-center overflow-hidden shrink-0">
            {iconPreview ? (
              <img src={iconPreview} alt="Workspace Icon Preview" className="w-full h-full object-cover" />
            ) : (
              <Upload className="w-5 h-5 text-muted-foreground" />
            )}
            <input
              type="file"
              accept="image/*"
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={handleIconChange}
              title="Upload Workspace Icon"
            />
          </div>
          <div className="space-y-0.5">
            <span className="block text-[13px] font-medium text-foreground">Workspace icon</span>
            <span className="block text-[11px] text-muted-foreground">JPG, PNG or WebP - max 2MB<br />Or we'll use your initials</span>
          </div>
        </div>

        {/* Workspace Name */}
        <div className="space-y-1.5">
          <label htmlFor="name" className="block text-[12px] font-medium text-muted-foreground">
            Workspace name <span className="text-destructive">*</span>
          </label>
          <input
            id="name"
            type="text"
            placeholder="Smart grid monitoring system"
            {...register("name")}
            className={`w-full h-10 px-3.5 bg-card border ${
              errors.name ? "border-destructive" : "border-border"
            } rounded-md text-[14px] text-foreground placeholder-muted-foreground/60 focus:border-primary focus:ring-[3px] focus:ring-primary/15 outline-none transition-all`}
          />
          {errors.name && (
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-destructive">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{errors.name.message}</span>
            </div>
          )}
        </div>

        {/* Workspace URL Slug */}
        <div className="space-y-1.5">
          <label htmlFor="urlSlug" className="block text-[12px] font-medium text-muted-foreground">
            Workspace URL
          </label>
          <div className="flex rounded-md overflow-hidden bg-card border border-border focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15 transition-all">
            <span className="h-10 px-3 flex items-center bg-secondary border-r border-border text-[13px] text-muted-foreground select-none shrink-0">
              researchmind.dev/
            </span>
            <input
              id="urlSlug"
              type="text"
              placeholder="smart-grid-monitoring"
              {...register("urlSlug")}
              onChange={(e) => {
                setSlugEdited(true);
                setValue("urlSlug", e.target.value, { shouldValidate: true });
              }}
              className="flex-1 h-10 px-3 bg-transparent text-[14px] text-foreground placeholder-muted-foreground/60 outline-none"
            />
          </div>
          <span className="block text-[11px] text-muted-foreground mt-1">Auto-generated from name - editable</span>
          {errors.urlSlug && (
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-destructive">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{errors.urlSlug.message}</span>
            </div>
          )}
        </div>

        {/* Description (Max 200 Characters) */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label htmlFor="description" className="block text-[12px] font-medium text-muted-foreground">
              Description <span className="text-[11px] text-muted-foreground/60">(optional)</span>
            </label>
            <span className={`text-[11px] ${descriptionValue.length > 200 ? "text-destructive font-medium" : "text-muted-foreground/60"}`}>
              {descriptionValue.length}/200
            </span>
          </div>
          <textarea
            id="description"
            placeholder="Briefly describe your project's goal..."
            rows={3}
            {...register("description")}
            className={`w-full p-3 bg-card border ${
              errors.description ? "border-destructive" : "border-border"
            } rounded-md text-[14px] text-foreground placeholder-muted-foreground/60 focus:border-primary focus:ring-[3px] focus:ring-primary/15 outline-none transition-all resize-none`}
          />
          {errors.description && (
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-destructive">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{errors.description.message}</span>
            </div>
          )}
        </div>

        {/* Actions Button */}
        <div className="flex justify-end pt-3">
          <Button
            type="submit"
            className="h-10 px-6 bg-primary text-white hover:bg-primary/90 font-medium text-[14px] rounded-md transition-colors"
          >
            Continue &rarr;
          </Button>
        </div>
      </form>
    </div>
  );
};
