#include <stdio.h>
#include <stdlib.h>
#ifdef __APPLE__
#include <OpenCL/opencl.h>
#else
#include <CL/cl.h>
#endif

#define MAX_SOURCE_SIZE 0x100000

int main() {
    FILE* fp = fopen("./kernel_file.cl", "r");
    if (!fp) { fprintf(stderr, "Failed to load kernel\n"); return 1; }

    char* source_str = (char*)malloc(MAX_SOURCE_SIZE);
    size_t source_size = fread(source_str, 1, MAX_SOURCE_SIZE, fp);
    fclose(fp);

    cl_platform_id platform_id;
    cl_device_id device_id;
    cl_uint ret_num_devices, ret_num_platforms;
    cl_int ret;

    ret = clGetPlatformIDs(1, &platform_id, &ret_num_platforms);
    if (ret != CL_SUCCESS) {
        fprintf(stderr, "Failed to get OpenCL platform: %d\n", ret);
        return 1;
    }

    ret = clGetDeviceIDs(platform_id, CL_DEVICE_TYPE_GPU, 1, &device_id, &ret_num_devices);
    if (ret != CL_SUCCESS) {
        fprintf(stderr, "GPU device unavailable, falling back to CPU device: %d\n", ret);
        ret = clGetDeviceIDs(platform_id, CL_DEVICE_TYPE_CPU, 1, &device_id, &ret_num_devices);
        if (ret != CL_SUCCESS) {
            fprintf(stderr, "Failed to get a CPU device as fallback: %d\n", ret);
            return 1;
        }
    }

    cl_context context = clCreateContext(NULL, 1, &device_id, NULL, NULL, &ret);
    if (ret != CL_SUCCESS) {
        fprintf(stderr, "Failed to create OpenCL context: %d\n", ret);
        return 1;
    }

    cl_command_queue queue = clCreateCommandQueueWithProperties(context, device_id, 0, &ret);
    if (ret != CL_SUCCESS) {
        fprintf(stderr, "Failed to create command queue: %d\n", ret);
        return 1;
    }

    cl_program program = clCreateProgramWithSource(context, 1, (const char**)&source_str, &source_size, &ret);
    if (ret != CL_SUCCESS) {
        fprintf(stderr, "Failed to create program from source: %d\n", ret);
        return 1;
    }

    ret = clBuildProgram(program, 1, &device_id, NULL, NULL, NULL);
    if (ret != CL_SUCCESS) {
        size_t log_size = 0;
        clGetProgramBuildInfo(program, device_id, CL_PROGRAM_BUILD_LOG, 0, NULL, &log_size);
        char* log = (char*)malloc(log_size + 1);
        if (log) {
            clGetProgramBuildInfo(program, device_id, CL_PROGRAM_BUILD_LOG, log_size, log, NULL);
            log[log_size] = '\0';
            fprintf(stderr, "Kernel build error (code %d):\n%s\n", ret, log);
            free(log);
        } else {
            fprintf(stderr, "Kernel build error (code %d): failed to allocate log buffer\n", ret);
        }
        return 1;
    }

    cl_kernel kernel = clCreateKernel(program, "simpleKernel", &ret);
    if (ret != CL_SUCCESS) {
        fprintf(stderr, "Failed to create kernel: %d\n", ret);
        return 1;
    }

    int n = 10;
    cl_mem memobj = clCreateBuffer(context, CL_MEM_WRITE_ONLY, n * sizeof(float), NULL, &ret);

    clSetKernelArg(kernel, 0, sizeof(cl_mem), &memobj);
    clSetKernelArg(kernel, 1, sizeof(int), &n);

    size_t global_size = n;

    // Task call: clEnqueueTask()
    // Data-parallel call: clEnqueueNDRangeKernel()

    clEnqueueNDRangeKernel(queue, kernel, 1, NULL, &global_size, NULL, 0, NULL, NULL);

    float* results = (float*)malloc(sizeof(float) * n);
    clEnqueueReadBuffer(queue, memobj, CL_TRUE, 0, n * sizeof(float), results, 0, NULL, NULL);

    printf("Results: ");
    for (int i = 0; i < n; i++)
        printf("%f ", results[i]);
    printf("\n");

    free(results);
    clReleaseMemObject(memobj);
    clReleaseKernel(kernel);
    clReleaseProgram(program);
    clReleaseCommandQueue(queue);
    clReleaseContext(context);
    free(source_str);

    return 0;
}