#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __APPLE__
#include <OpenCL/opencl.h>
#else
#include <CL/cl.h>
#endif

#define MAX_SOURCE_SIZE 0x100000

static FILE *fp = NULL;
static const char fileName[] = "./kernel.cl";
static char *source_str = NULL;
static size_t source_size = 0;
static int source_loaded = 0;

static int load_kernel_source(void)
{
    if (source_loaded)
        return 0;

    fp = fopen(fileName, "r");
    if (!fp) {
        fprintf(stderr, "Failed to load kernel file %s\n", fileName);
        return -1;
    }

    source_str = (char *)malloc(MAX_SOURCE_SIZE);
    if (!source_str) {
        fprintf(stderr, "Failed to allocate kernel source buffer.\n");
        fclose(fp);
        return -1;
    }

    source_size = fread(source_str, 1, MAX_SOURCE_SIZE, fp);
    fclose(fp);

    source_loaded = 1;
    return 0;
}

int main()
{
    cl_device_id device_id;

    if (load_kernel_source() != 0)
        return 1;

    cl_context context;
    cl_command_queue command_queue;
    cl_program program;
    cl_kernel kernel;
    cl_platform_id platform_id;
    cl_uint ret_num_devices;
    cl_uint ret_num_platforms;
    cl_int ret;

    /* Platform + Device */
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

    /* Context */
    context = clCreateContext(NULL, 1, &device_id, NULL, NULL, &ret);
    if (ret != CL_SUCCESS) {
        fprintf(stderr, "Failed to create OpenCL context: %d\n", ret);
        return 1;
    }

    /* Command queue */
    command_queue = clCreateCommandQueue(context, device_id, 0, &ret);

    /* Program */
    program = clCreateProgramWithSource(context, 1,
                                        (const char **)&source_str,
                                        &source_size, &ret);
    if (ret != CL_SUCCESS) {
        fprintf(stderr, "Failed to create OpenCL program from source: %d\n", ret);
        return 1;
    }

    ret = clBuildProgram(program, 1, &device_id, NULL, NULL, NULL);
    if (ret != CL_SUCCESS) {
        size_t log_size = 0;
        clGetProgramBuildInfo(program, device_id, CL_PROGRAM_BUILD_LOG, 0, NULL, &log_size);
        char *log = (char *)malloc(log_size + 1);
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

    /* Kernel */
    kernel = clCreateKernel(program, "monteCarloOption", &ret);
    if (ret != CL_SUCCESS) {
        fprintf(stderr, "Failed to create kernel: %d\n", ret);
        return 1;
    }

    printf("MC Engine Ready\n");
    fflush(stdout);

    /* Persistent worker loop */
    while (1)
    {
        char input[256];

        if (!fgets(input, sizeof(input), stdin))
            break;

        int runs;
        float S0, K, r, sigma, T;

        sscanf(input, "%d %f %f %f %f %f",
               &runs, &S0, &K, &r, &sigma, &T);

        cl_mem memobj = clCreateBuffer(
            context,
            CL_MEM_WRITE_ONLY,
            runs * sizeof(float),
            NULL,
            &ret
        );

        /* Set kernel arguments */
        clSetKernelArg(kernel, 0, sizeof(float), &S0);
        clSetKernelArg(kernel, 1, sizeof(float), &K);
        clSetKernelArg(kernel, 2, sizeof(float), &r);
        clSetKernelArg(kernel, 3, sizeof(float), &sigma);
        clSetKernelArg(kernel, 4, sizeof(float), &T);
        clSetKernelArg(kernel, 5, sizeof(int), &runs);
        clSetKernelArg(kernel, 6, sizeof(cl_mem), &memobj);

        size_t global_size = runs;

        clEnqueueNDRangeKernel(
            command_queue,
            kernel,
            1,
            NULL,
            &global_size,
            NULL,
            0,
            NULL,
            NULL
        );

        float *results = (float*)malloc(sizeof(float) * runs);

        clEnqueueReadBuffer(
            command_queue,
            memobj,
            CL_TRUE,
            0,
            runs * sizeof(float),
            results,
            0,
            NULL,
            NULL
        );

        double sum = 0;

        for(int i = 0; i < runs; i++)
            sum += results[i];

        float price = sum / runs;

        /* Send result to Node.js */
        printf("%f\n", price);
        fflush(stdout);

        clReleaseMemObject(memobj);
        free(results);
    }

    /* Cleanup */
    clReleaseKernel(kernel);
    clReleaseProgram(program);
    clReleaseCommandQueue(command_queue);
    clReleaseContext(context);

    free(source_str);

    return 0;
}